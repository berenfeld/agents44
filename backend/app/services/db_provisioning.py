"""PostgreSQL schema and role provisioning for agents and departments."""

import re
import secrets
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Connection

IDENTIFIER_RE = re.compile(r"^[a-z][a-z0-9_]*$")
SYSTEM_SCHEMAS = frozenset({"public", "pg_catalog", "information_schema"})


def slugify_identifier(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")
    if not slug or not slug[0].isalpha():
        slug = f"a_{slug or 'agent'}"
    return slug[:128]


def department_schema_name(department: str) -> str:
    name = department.strip().lower()
    if not IDENTIFIER_RE.match(name):
        raise ValueError(f"Invalid department schema name: {department!r}")
    return name


def agent_schema_name(agent_name: str) -> str:
    return f"agent_{slugify_identifier(agent_name)}"


def agent_db_user(agent_name: str) -> str:
    return f"agent_{slugify_identifier(agent_name)}"


def quote_ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def quote_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _execute(conn: Connection, sql: str) -> None:
    conn.execute(text(sql))


def _app_db_role(conn: Connection) -> str:
    return conn.execute(text("SELECT current_user")).scalar_one()


def create_department_schema(conn: Connection, department: str) -> str:
    schema = department_schema_name(department)
    owner = _app_db_role(conn)
    owner_sql = quote_ident(owner)
    schema_sql = quote_ident(schema)
    _execute(conn, f"CREATE SCHEMA IF NOT EXISTS {schema_sql}")
    _execute(conn, f"ALTER SCHEMA {schema_sql} OWNER TO {owner_sql}")
    return schema


def _grant_department_schema_access(
    conn: Connection,
    *,
    app_role: str,
    agent_role: str,
    schema: str,
) -> None:
    app_sql = quote_ident(app_role)
    agent_sql = quote_ident(agent_role)
    schema_sql = quote_ident(schema)
    _execute(conn, f"GRANT ALL ON SCHEMA {schema_sql} TO {agent_sql}")
    _execute(conn, f"GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA {schema_sql} TO {agent_sql}")
    _execute(conn, f"GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA {schema_sql} TO {agent_sql}")
    _execute(conn, f"GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA {schema_sql} TO {agent_sql}")
    _execute(
        conn,
        f"ALTER DEFAULT PRIVILEGES FOR ROLE {app_sql} IN SCHEMA {schema_sql} "
        f"GRANT ALL ON TABLES TO {agent_sql}",
    )
    _execute(
        conn,
        f"ALTER DEFAULT PRIVILEGES FOR ROLE {app_sql} IN SCHEMA {schema_sql} "
        f"GRANT ALL ON SEQUENCES TO {agent_sql}",
    )


def _reassign_schema_objects(conn: Connection, schema: str, new_owner: str) -> None:
    if not IDENTIFIER_RE.match(schema) or not IDENTIFIER_RE.match(new_owner):
        raise ValueError("Invalid schema or owner identifier")
    schema_sql = quote_ident(schema)
    owner_sql = quote_ident(new_owner)
    _execute(
        conn,
        f"""
        DO $reassign$ DECLARE item record;
        BEGIN
          FOR item IN
            SELECT c.relkind, c.relname
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = '{schema}'
              AND c.relkind IN ('r', 'v', 'm', 'S', 'f', 'p')
          LOOP
            IF item.relkind = 'S' THEN
              EXECUTE format('ALTER SEQUENCE %I.%I OWNER TO %I', '{schema}', item.relname, '{new_owner}');
            ELSE
              EXECUTE format('ALTER TABLE %I.%I OWNER TO %I', '{schema}', item.relname, '{new_owner}');
            END IF;
          END LOOP;
        END $reassign$;
        """,
    )
    _execute(conn, f"ALTER SCHEMA {schema_sql} OWNER TO {owner_sql}")


def _provision_agent_owned_schema(conn: Connection, agent_role: str, schema: str) -> None:
    schema_sql = quote_ident(schema)
    role_sql = quote_ident(agent_role)
    _execute(conn, f"CREATE SCHEMA IF NOT EXISTS {schema_sql}")
    _reassign_schema_objects(conn, schema, agent_role)
    _execute(
        conn,
        f"ALTER DEFAULT PRIVILEGES FOR ROLE {role_sql} IN SCHEMA {schema_sql} "
        f"GRANT ALL ON TABLES TO {role_sql}",
    )
    _execute(
        conn,
        f"ALTER DEFAULT PRIVILEGES FOR ROLE {role_sql} IN SCHEMA {schema_sql} "
        f"GRANT ALL ON SEQUENCES TO {role_sql}",
    )


def _grant_read_schema(conn: Connection, app_role: str, agent_role: str, schema: str) -> None:
    app_sql = quote_ident(app_role)
    agent_sql = quote_ident(agent_role)
    schema_sql = quote_ident(schema)
    _execute(conn, f"GRANT USAGE ON SCHEMA {schema_sql} TO {agent_sql}")
    _execute(conn, f"GRANT SELECT ON ALL TABLES IN SCHEMA {schema_sql} TO {agent_sql}")
    _execute(
        conn,
        f"ALTER DEFAULT PRIVILEGES FOR ROLE {app_sql} IN SCHEMA {schema_sql} "
        f"GRANT SELECT ON TABLES TO {agent_sql}",
    )


def _revoke_public_access(conn: Connection, role: str) -> None:
    role_sql = quote_ident(role)
    _execute(conn, f"REVOKE CREATE ON SCHEMA public FROM {role_sql}")
    _execute(conn, f"REVOKE ALL ON ALL TABLES IN SCHEMA public FROM {role_sql}")
    _execute(conn, f"REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM {role_sql}")


def create_agent_role(
    conn: Connection,
    *,
    agent_name: str,
    department: str,
    password: str | None = None,
) -> dict[str, str]:
    role = agent_db_user(agent_name)
    agent_schema = agent_schema_name(agent_name)
    dept_schema = create_department_schema(conn, department)
    app_role = _app_db_role(conn)
    secret = password or secrets.token_urlsafe(32)

    _execute(
        conn,
        f"DO $$ BEGIN CREATE ROLE {quote_ident(role)} LOGIN PASSWORD {quote_literal(secret)}; "
        f"EXCEPTION WHEN duplicate_object THEN "
        f"ALTER ROLE {quote_ident(role)} LOGIN PASSWORD {quote_literal(secret)}; END $$;",
    )

    _provision_agent_owned_schema(conn, role, agent_schema)
    _grant_department_schema_access(conn, app_role=app_role, agent_role=role, schema=dept_schema)
    _revoke_public_access(conn, role)

    return {
        "db_user": role,
        "db_password": secret,
        "db_schema": agent_schema,
        "department_schema": dept_schema,
    }


def grant_cross_schema_read(
    conn: Connection,
    *,
    app_role: str,
    agent_role: str,
    department_schemas: list[str],
    agent_schemas: list[str],
    writable_department_schema: str,
    writable_agent_schema: str,
) -> None:
    writable = {writable_department_schema, writable_agent_schema}
    for schema in department_schemas:
        if schema not in writable:
            _grant_read_schema(conn, app_role, agent_role, schema)
    for schema in agent_schemas:
        if schema not in writable:
            _grant_read_schema(conn, app_role, agent_role, schema)


def drop_legacy_public_agent_tables(conn: Connection) -> None:
    _execute(conn, "DROP TABLE IF EXISTS stock_prices CASCADE")
    _execute(conn, "DROP TABLE IF EXISTS stocks CASCADE")


def repair_all_agent_db_grants(conn: Connection) -> None:
    app_role = _app_db_role(conn)
    departments = [
        row[0]
        for row in conn.execute(text("SELECT name FROM system_departments ORDER BY name")).fetchall()
    ]
    agents = conn.execute(
        text("SELECT name, department, db_user FROM system_agents ORDER BY name")
    ).fetchall()

    for name in departments:
        create_department_schema(conn, name)

    for agent_name, department, db_user in agents:
        if not db_user:
            continue
        role = db_user
        agent_schema = agent_schema_name(agent_name)
        dept_schema = department_schema_name(department)
        _provision_agent_owned_schema(conn, role, agent_schema)
        _grant_department_schema_access(
            conn, app_role=app_role, agent_role=role, schema=dept_schema
        )
        _revoke_public_access(conn, role)

    refresh_all_cross_grants(conn)


def provision_existing_agents_and_departments(conn: Connection) -> None:
    departments = [
        row[0]
        for row in conn.execute(text("SELECT name FROM system_departments ORDER BY name")).fetchall()
    ]
    agents = conn.execute(
        text("SELECT name, department FROM system_agents ORDER BY name")
    ).fetchall()

    for name in departments:
        create_department_schema(conn, name)

    for agent_name, department in agents:
        creds = create_agent_role(conn, agent_name=agent_name, department=department)
        conn.execute(
            text(
                "UPDATE system_agents SET db_user = :db_user, db_password = :db_password "
                "WHERE name = :name"
            ),
            {"db_user": creds["db_user"], "db_password": creds["db_password"], "name": agent_name},
        )

    refresh_all_cross_grants(conn)


def refresh_all_cross_grants(conn: Connection) -> None:
    app_role = _app_db_role(conn)
    departments = [
        row[0]
        for row in conn.execute(text("SELECT name FROM system_departments ORDER BY name")).fetchall()
    ]
    agents = conn.execute(
        text("SELECT name, department, db_user FROM system_agents ORDER BY name")
    ).fetchall()
    department_schemas = [department_schema_name(name) for name in departments]
    agent_schemas = [agent_schema_name(name) for name, _, _ in agents]

    for agent_name, department, db_user in agents:
        if not db_user:
            continue
        grant_cross_schema_read(
            conn,
            app_role=app_role,
            agent_role=db_user,
            department_schemas=department_schemas,
            agent_schemas=agent_schemas,
            writable_department_schema=department_schema_name(department),
            writable_agent_schema=agent_schema_name(agent_name),
        )


def drop_agent_db_access(conn: Connection, *, agent_name: str, db_user: str | None = None) -> None:
    role = db_user or agent_db_user(agent_name)
    schema = agent_schema_name(agent_name)
    role_sql = quote_ident(role)
    schema_sql = quote_ident(schema)
    _execute(conn, f"DROP SCHEMA IF EXISTS {schema_sql} CASCADE")
    _execute(conn, f"DROP OWNED BY {role_sql} CASCADE")
    _execute(conn, f"DROP ROLE IF EXISTS {role_sql}")


def drop_department_schema(conn: Connection, department: str) -> None:
    schema = department_schema_name(department)
    _execute(conn, f"DROP SCHEMA IF EXISTS {quote_ident(schema)} CASCADE")


def teardown_provisioned_schemas(conn: Connection) -> None:
    agents = conn.execute(text("SELECT name, db_user FROM system_agents ORDER BY name")).fetchall()
    for agent_name, db_user in agents:
        drop_agent_db_access(conn, agent_name=agent_name, db_user=db_user)

    departments = conn.execute(text("SELECT name FROM system_departments ORDER BY name")).fetchall()
    for (department,) in departments:
        drop_department_schema(conn, department)


def agent_database_url(
    *,
    host: str,
    port: str,
    database: str,
    db_user: str,
    db_password: str,
    agent_schema: str,
    department_schema: str,
) -> str:
    from urllib.parse import quote_plus

    options = quote_plus(f"-c search_path={agent_schema},{department_schema},public")
    return (
        f"postgresql://{quote_plus(db_user)}:{quote_plus(db_password)}"
        f"@{host}:{port}/{database}?options={options}"
    )


def build_agent_db_instructions(*, agent_name: str, department: str, db_user: str | None = None) -> str:
    personal_schema = agent_schema_name(agent_name)
    shared_schema = department_schema_name(department)
    role = db_user or agent_db_user(agent_name)
    return "\n".join(
        [
            "# Database access",
            "",
            f"You connect to PostgreSQL as role `{role}`.",
            f"Your `search_path` is `{personal_schema}, {shared_schema}, public` (personal schema first).",
            "",
            "## Where to store data",
            "",
            f"- **Personal schema `{personal_schema}`** — tables only you use. You own this schema: CREATE/ALTER/DROP tables, full read/write.",
            f"- **Department schema `{shared_schema}`** — tables shared with all agents in the `{department}` department. Full read/write here, but the schema is owned by the platform (not you). Do not DROP the schema or shared tables other agents rely on.",
            "- **Other agent and department schemas** — SELECT only (read other agents' published data; you cannot modify it).",
            "- **`public` / `system_*` tables** — no access (platform internals).",
            "",
            "## MCP tools",
            "",
            "- `read_db` — run a SQL query (typically SELECT). Returns rows.",
            "- `write_db` — run a SQL statement that changes data or schema (INSERT, UPDATE, DELETE, CREATE TABLE, etc.). Commits automatically.",
            "",
            "PostgreSQL enforces permissions; the tools do not filter your SQL.",
            "",
            "Examples:",
            f"- Personal table: `CREATE TABLE daily_prices (...)` or `CREATE TABLE {personal_schema}.daily_prices (...)`",
            f"- Shared table: `CREATE TABLE {shared_schema}.companies (...)`",
            "- Read another department: `SELECT * FROM research.some_table LIMIT 10`",
        ]
    )


def load_agent_db_credentials(conn: Connection, agent_name: str) -> dict[str, Any] | None:
    row = conn.execute(
        text(
            "SELECT db_user, db_password, department FROM system_agents WHERE name = :name"
        ),
        {"name": agent_name},
    ).one_or_none()
    if row is None or not row.db_user or not row.db_password:
        return None
    return {
        "db_user": row.db_user,
        "db_password": row.db_password,
        "department": row.department,
        "agent_schema": agent_schema_name(agent_name),
        "department_schema": department_schema_name(row.department),
    }
