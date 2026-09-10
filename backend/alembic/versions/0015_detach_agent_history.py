"""nullable agent FKs and name snapshots so agents can be deleted

Revision ID: 0015
"""
from alembic import op
import sqlalchemy as sa

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("system_claude_conversations", sa.Column("agent_name", sa.String(length=128), nullable=True))
    op.execute(
        sa.text(
            """
            UPDATE system_claude_conversations AS c
            SET agent_name = a.name
            FROM system_agents AS a
            WHERE c.agent_id = a.id
            """
        )
    )
    op.alter_column("system_claude_conversations", "agent_id", existing_type=sa.Integer(), nullable=True)

    op.add_column("system_email_messages", sa.Column("agent_name", sa.String(length=128), nullable=True))
    op.execute(
        sa.text(
            """
            UPDATE system_email_messages AS m
            SET agent_name = a.name
            FROM system_agents AS a
            WHERE m.agent_id = a.id
            """
        )
    )
    op.alter_column("system_email_messages", "agent_id", existing_type=sa.Integer(), nullable=True)

    op.add_column("system_whatsapp_conversations", sa.Column("agent_name", sa.String(length=128), nullable=True))
    op.execute(
        sa.text(
            """
            UPDATE system_whatsapp_conversations AS c
            SET agent_name = a.name
            FROM system_agents AS a
            WHERE c.agent_id = a.id
            """
        )
    )
    op.alter_column("system_whatsapp_conversations", "agent_id", existing_type=sa.Integer(), nullable=True)

    op.add_column("system_agents_runs", sa.Column("agent_name", sa.String(length=128), nullable=True))
    op.execute(
        sa.text(
            """
            UPDATE system_agents_runs AS r
            SET agent_name = a.name
            FROM system_agents AS a
            WHERE r.agent_id = a.id
            """
        )
    )
    op.alter_column("system_agents_runs", "agent_id", existing_type=sa.Integer(), nullable=True)


def downgrade() -> None:
    op.alter_column("system_agents_runs", "agent_id", existing_type=sa.Integer(), nullable=False)
    op.drop_column("system_agents_runs", "agent_name")
    op.alter_column("system_whatsapp_conversations", "agent_id", existing_type=sa.Integer(), nullable=False)
    op.drop_column("system_whatsapp_conversations", "agent_name")
    op.alter_column("system_email_messages", "agent_id", existing_type=sa.Integer(), nullable=False)
    op.drop_column("system_email_messages", "agent_name")
    op.alter_column("system_claude_conversations", "agent_id", existing_type=sa.Integer(), nullable=False)
    op.drop_column("system_claude_conversations", "agent_name")
