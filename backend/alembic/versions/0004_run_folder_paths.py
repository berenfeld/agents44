"""run folder paths on agent runs

Revision ID: 0004
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0004"
down_revision = "0002"
branch_labels = None
depends_on = None


def _column_names(table: str) -> set[str]:
    return {col["name"] for col in inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    columns = _column_names("system_agents_runs")
    if "run_dir" not in columns:
        op.add_column("system_agents_runs", sa.Column("run_dir", sa.String(length=512), nullable=True))
    if "prompt_path" not in columns:
        op.add_column("system_agents_runs", sa.Column("prompt_path", sa.String(length=512), nullable=True))


def downgrade() -> None:
    columns = _column_names("system_agents_runs")
    if "prompt_path" in columns:
        op.drop_column("system_agents_runs", "prompt_path")
    if "run_dir" in columns:
        op.drop_column("system_agents_runs", "run_dir")
