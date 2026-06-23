"""lock down public schema for agent roles

Revision ID: 0010
"""
from alembic import op

from app.services.db_provisioning import repair_all_agent_db_grants

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    repair_all_agent_db_grants(op.get_bind())


def downgrade() -> None:
    pass
