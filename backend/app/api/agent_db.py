from flask import Blueprint, jsonify, request

from app.auth import login_required
from app.errors import api_endpoint
from app.services import agent_db

agent_db_bp = Blueprint("agent_db", __name__)


@agent_db_bp.get("/meta")
@api_endpoint
@login_required
def database_meta():
    return jsonify(agent_db.get_database_meta())


@agent_db_bp.get("/tables")
@api_endpoint
@login_required
def list_tables():
    return jsonify(agent_db.list_tables())


@agent_db_bp.get("/tables/<path:table_name>/schema")
@api_endpoint
@login_required
def table_schema(table_name: str):
    return jsonify(agent_db.get_table_schema(table_name))


@agent_db_bp.get("/tables/<path:table_name>/rows")
@api_endpoint
@login_required
def table_rows(table_name: str):
    limit = request.args.get("limit", type=int) or agent_db.DEFAULT_ROW_LIMIT
    offset = request.args.get("offset", type=int) or 0
    sort_by = request.args.get("sort_by", type=str)
    sort_dir = request.args.get("sort_dir", type=str)
    filter_column = request.args.get("filter_column", type=str)
    filter_op = request.args.get("filter_op", type=str)
    filter_value = request.args.get("filter_value", type=str)
    return jsonify(
        agent_db.list_rows(
            table_name,
            limit=limit,
            offset=offset,
            sort_by=sort_by,
            sort_dir=sort_dir,
            filter_column=filter_column,
            filter_op=filter_op,
            filter_value=filter_value,
        )
    )


@agent_db_bp.post("/tables/<path:table_name>/rows")
@api_endpoint
@login_required
def create_row(table_name: str):
    payload = request.get_json(force=True) or {}
    values = payload.get("values") or payload
    row = agent_db.insert_row(table_name, values)
    return jsonify(row), 201


@agent_db_bp.put("/tables/<path:table_name>/rows")
@api_endpoint
@login_required
def update_row(table_name: str):
    payload = request.get_json(force=True) or {}
    keys = payload.get("keys") or {}
    values = payload.get("values") or {}
    row = agent_db.update_row(table_name, keys, values)
    return jsonify(row)


@agent_db_bp.delete("/tables/<path:table_name>/rows")
@api_endpoint
@login_required
def delete_row(table_name: str):
    payload = request.get_json(force=True) or {}
    keys = payload.get("keys") or payload
    result = agent_db.delete_row(table_name, keys)
    return jsonify(result)
