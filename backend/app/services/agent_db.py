import json
import re
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import MetaData, Table, delete, func, insert, inspect, select, update
from sqlalchemy.engine import RowMapping

from app.errors import APIClientError
from app.extensions import db

SYSTEM_TABLES = frozenset(
    {
        "alembic_version",
        "system_agents",
        "system_agents_runs",
        "system_departments",
        "system_params",
    }
)

TABLE_NAME_RE = re.compile(r"^[a-z][a-z0-9_]*$")
DEFAULT_ROW_LIMIT = 500
MAX_ROW_LIMIT = 2000


def _validate_table_name(table_name: str) -> str:
    name = table_name.strip().lower()
    if not TABLE_NAME_RE.match(name):
        raise APIClientError("Invalid table name", 400)
    if name in SYSTEM_TABLES:
        raise APIClientError("Table not allowed", 403)
    inspector = inspect(db.engine)
    if name not in inspector.get_table_names():
        raise APIClientError("Table not found", 404)
    return name


def _serialize_value(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (bytes, bytearray)):
        return value.decode("utf-8", errors="replace")
    return value


def _serialize_row(row: RowMapping | dict) -> dict:
    return {key: _serialize_value(value) for key, value in dict(row).items()}


def _normalize_type(type_name: str) -> str:
    lowered = type_name.lower()
    if "bool" in lowered:
        return "boolean"
    if any(token in lowered for token in ("int", "serial", "bigint", "smallint")):
        return "integer"
    if any(token in lowered for token in ("numeric", "decimal", "float", "double", "real")):
        return "number"
    if lowered == "date":
        return "date"
    if "time" in lowered or "timestamp" in lowered:
        return "datetime"
    if "json" in lowered:
        return "json"
    return "string"


def _reflect_table(table_name: str) -> Table:
    metadata = MetaData()
    return Table(table_name, metadata, autoload_with=db.engine)


def list_tables() -> list[dict]:
    inspector = inspect(db.engine)
    names = sorted(name for name in inspector.get_table_names() if name not in SYSTEM_TABLES)
    counts: dict[str, int] = {}
    if names:
        for name in names:
            table = _reflect_table(name)
            count = db.session.execute(select(func.count()).select_from(table)).scalar_one()
            counts[name] = int(count)
    return [{"name": name, "row_count": counts.get(name, 0)} for name in names]


def get_table_schema(table_name: str) -> dict:
    name = _validate_table_name(table_name)
    inspector = inspect(db.engine)
    pk_cols = inspector.get_pk_constraint(name).get("constrained_columns") or []
    columns = []
    for col in inspector.get_columns(name):
        columns.append(
            {
                "name": col["name"],
                "type": _normalize_type(str(col["type"])),
                "nullable": bool(col.get("nullable", True)),
                "primary_key": col["name"] in pk_cols,
                "autoincrement": bool(col.get("autoincrement", False)),
                "default": _serialize_value(col.get("default")),
            }
        )
    foreign_keys = []
    for fk in inspector.get_foreign_keys(name):
        foreign_keys.append(
            {
                "columns": fk.get("constrained_columns") or [],
                "referred_table": fk.get("referred_table"),
                "referred_columns": fk.get("referred_columns") or [],
            }
        )
    return {"name": name, "columns": columns, "primary_keys": pk_cols, "foreign_keys": foreign_keys}


def _coerce_input(value: Any, column_type: str) -> Any:
    if value is None or value == "":
        return None
    if column_type == "boolean":
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            lowered = value.strip().lower()
            if lowered in {"true", "1", "yes", "on"}:
                return True
            if lowered in {"false", "0", "no", "off"}:
                return False
        raise APIClientError(f"Invalid boolean value: {value!r}", 400)
    if column_type == "integer":
        return int(value)
    if column_type == "number":
        return float(value)
    if column_type == "date":
        if isinstance(value, date) and not isinstance(value, datetime):
            return value
        return date.fromisoformat(str(value))
    if column_type == "datetime":
        if isinstance(value, datetime):
            return value
        text = str(value)
        if text.endswith("Z"):
            text = f"{text[:-1]}+00:00"
        return datetime.fromisoformat(text)
    if column_type == "json":
        if isinstance(value, (dict, list)):
            return value
        return json.loads(str(value))
    return str(value)


def _filter_values(table_name: str, values: dict, *, for_insert: bool) -> dict:
    schema = get_table_schema(table_name)
    allowed = {col["name"]: col for col in schema["columns"]}
    filtered: dict[str, Any] = {}
    for key, raw in values.items():
        if key not in allowed:
            continue
        col = allowed[key]
        if col["primary_key"] and col["autoincrement"] and for_insert and (raw is None or raw == ""):
            continue
        if raw is None or raw == "":
            if not col["nullable"] and for_insert:
                if col["default"] is not None:
                    continue
                raise APIClientError(f"Column {key} is required", 400)
            filtered[key] = None
            continue
        filtered[key] = _coerce_input(raw, col["type"])
    return filtered


def list_rows(table_name: str, *, limit: int = DEFAULT_ROW_LIMIT, offset: int = 0) -> dict:
    name = _validate_table_name(table_name)
    limit = max(1, min(limit, MAX_ROW_LIMIT))
    offset = max(0, offset)
    table = _reflect_table(name)
    total = db.session.execute(select(func.count()).select_from(table)).scalar_one()
    stmt = select(table).limit(limit).offset(offset)
    pk_cols = get_table_schema(name)["primary_keys"]
    if pk_cols:
        stmt = stmt.order_by(*[table.c[col] for col in pk_cols])
    rows = db.session.execute(stmt).mappings().all()
    return {
        "items": [_serialize_row(row) for row in rows],
        "total": int(total),
        "limit": limit,
        "offset": offset,
    }


def insert_row(table_name: str, values: dict) -> dict:
    name = _validate_table_name(table_name)
    if not values:
        raise APIClientError("No values provided", 400)
    payload = _filter_values(name, values, for_insert=True)
    if not payload:
        raise APIClientError("No insertable values provided", 400)
    table = _reflect_table(name)
    stmt = insert(table).values(**payload)
    if db.engine.dialect.name == "postgresql":
        stmt = stmt.returning(*table.c)
        row = db.session.execute(stmt).mappings().one()
        db.session.commit()
        return _serialize_row(row)
    db.session.execute(stmt)
    db.session.commit()
    schema = get_table_schema(name)
    if schema["primary_keys"]:
        keys = {pk: payload[pk] for pk in schema["primary_keys"] if pk in payload}
        if keys:
            where = [table.c[pk] == keys[pk] for pk in keys]
            row = db.session.execute(select(table).where(*where)).mappings().one()
            return _serialize_row(row)
    total = db.session.execute(select(func.count()).select_from(table)).scalar_one()
    if total:
        row = db.session.execute(select(table).limit(1).offset(int(total) - 1)).mappings().one()
        return _serialize_row(row)
    return {}


def _pk_where(table: Table, keys: dict, schema: dict) -> list:
    pk_cols = schema["primary_keys"]
    if not pk_cols:
        raise APIClientError("Table has no primary key; cannot update or delete by key", 400)
    missing = [col for col in pk_cols if col not in keys]
    if missing:
        raise APIClientError(f"Missing primary key columns: {', '.join(missing)}", 400)
    return [table.c[col] == _coerce_input(keys[col], next(c["type"] for c in schema["columns"] if c["name"] == col)) for col in pk_cols]


def update_row(table_name: str, keys: dict, values: dict) -> dict:
    name = _validate_table_name(table_name)
    if not values:
        raise APIClientError("No values provided", 400)
    schema = get_table_schema(name)
    payload = _filter_values(name, values, for_insert=False)
    for pk in schema["primary_keys"]:
        payload.pop(pk, None)
    if not payload:
        raise APIClientError("No updatable values provided", 400)
    table = _reflect_table(name)
    where = _pk_where(table, keys, schema)
    stmt = update(table).where(*where).values(**payload)
    if db.engine.dialect.name == "postgresql":
        stmt = stmt.returning(*table.c)
        row = db.session.execute(stmt).mappings().one_or_none()
        db.session.commit()
        if row is None:
            raise APIClientError("Row not found", 404)
        return _serialize_row(row)
    result = db.session.execute(stmt)
    db.session.commit()
    if result.rowcount == 0:
        raise APIClientError("Row not found", 404)
    row = db.session.execute(select(table).where(*where)).mappings().one()
    return _serialize_row(row)


def delete_row(table_name: str, keys: dict) -> dict:
    name = _validate_table_name(table_name)
    schema = get_table_schema(name)
    table = _reflect_table(name)
    where = _pk_where(table, keys, schema)
    stmt = delete(table).where(*where)
    result = db.session.execute(stmt)
    db.session.commit()
    if result.rowcount == 0:
        raise APIClientError("Row not found", 404)
    return {"deleted": True, "keys": keys}
