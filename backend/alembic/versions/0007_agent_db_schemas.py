"""agent db schemas and roles

Revision ID: 0007
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

from app.services.db_provisioning import (
    drop_legacy_public_agent_tables,
    provision_existing_agents_and_departments,
    teardown_provisioned_schemas,
)

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def _column_names(table: str) -> set[str]:
    return {col["name"] for col in inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    columns = _column_names("system_agents")
    if "db_user" not in columns:
        op.add_column("system_agents", sa.Column("db_user", sa.String(length=128), nullable=True))
    if "db_password" not in columns:
        op.add_column("system_agents", sa.Column("db_password", sa.String(length=256), nullable=True))

    conn = op.get_bind()
    drop_legacy_public_agent_tables(conn)
    provision_existing_agents_and_departments(conn)

    indexes = {idx["name"] for idx in inspect(conn).get_indexes("system_agents")}
    if "ix_system_agents_db_user" not in indexes:
        op.create_index("ix_system_agents_db_user", "system_agents", ["db_user"], unique=True)
    op.alter_column("system_agents", "db_user", nullable=False)
    op.alter_column("system_agents", "db_password", nullable=False)


def downgrade() -> None:
    conn = op.get_bind()
    teardown_provisioned_schemas(conn)

    indexes = {idx["name"] for idx in inspect(conn).get_indexes("system_agents")}
    if "ix_system_agents_db_user" in indexes:
        op.drop_index("ix_system_agents_db_user", table_name="system_agents")

    columns = _column_names("system_agents")
    if "db_password" in columns:
        op.drop_column("system_agents", "db_password")
    if "db_user" in columns:
        op.drop_column("system_agents", "db_user")
