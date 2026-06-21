"""repair agent schema ownership and department grants

Revision ID: 0008
"""
from alembic import op

from app.services.db_provisioning import repair_all_agent_db_grants

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    repair_all_agent_db_grants(op.get_bind())


def downgrade() -> None:
    pass
