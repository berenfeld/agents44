"""agent timeout seconds

Revision ID: 0005
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def _column_names(table: str) -> set[str]:
    return {col["name"] for col in inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    columns = _column_names("system_agents")
    if "timeout_seconds" not in columns:
        op.add_column(
            "system_agents",
            sa.Column("timeout_seconds", sa.Integer(), nullable=False, server_default="300"),
        )


def downgrade() -> None:
    columns = _column_names("system_agents")
    if "timeout_seconds" in columns:
        op.drop_column("system_agents", "timeout_seconds")
