"""claude conversation tabs and messages

Revision ID: 0012
"""
from alembic import op
import sqlalchemy as sa

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "system_claude_conversations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("title", sa.String(length=128), nullable=False, server_default="New conversation"),
        sa.Column("agent_id", sa.Integer(), sa.ForeignKey("system_agents.id"), nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", sa.String(length=256), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index(
        "ix_system_claude_conversations_agent_id",
        "system_claude_conversations",
        ["agent_id"],
    )
    op.create_index(
        "ix_system_claude_conversations_archived_at",
        "system_claude_conversations",
        ["archived_at"],
    )

    op.create_table(
        "system_claude_messages",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "conversation_id",
            sa.Integer(),
            sa.ForeignKey("system_claude_conversations.id"),
            nullable=False,
        ),
        sa.Column(
            "role",
            sa.Enum("user", "assistant", name="claudemessagerole"),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum("pending", "complete", "failed", name="claudemessagestatus"),
            nullable=False,
        ),
        sa.Column("content", sa.Text(), nullable=False, server_default=""),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("tokens_in", sa.Integer(), nullable=True),
        sa.Column("tokens_out", sa.Integer(), nullable=True),
        sa.Column("estimated_cost_usd", sa.Numeric(12, 6), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_system_claude_messages_conversation_id",
        "system_claude_messages",
        ["conversation_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_system_claude_messages_conversation_id", table_name="system_claude_messages")
    op.drop_table("system_claude_messages")
    op.drop_index("ix_system_claude_conversations_archived_at", table_name="system_claude_conversations")
    op.drop_index("ix_system_claude_conversations_agent_id", table_name="system_claude_conversations")
    op.drop_table("system_claude_conversations")
    op.execute("DROP TYPE IF EXISTS claudemessagestatus")
    op.execute("DROP TYPE IF EXISTS claudemessagerole")
