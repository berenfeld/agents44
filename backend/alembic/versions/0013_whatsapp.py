"""department WATI fields and WhatsApp conversation tables

Revision ID: 0013
"""
from alembic import op
import sqlalchemy as sa

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("ALTER TYPE triggersource ADD VALUE IF NOT EXISTS 'whatsapp'"))

    op.add_column("system_departments", sa.Column("whatsapp_from_number", sa.String(length=32), nullable=True))
    op.add_column("system_departments", sa.Column("wati_api_endpoint", sa.String(length=256), nullable=True))
    op.add_column("system_departments", sa.Column("wati_api_token", sa.String(length=2048), nullable=True))
    op.add_column("system_departments", sa.Column("wati_webhook_secret", sa.String(length=64), nullable=True))
    op.create_index(
        "uq_system_departments_whatsapp_from_number",
        "system_departments",
        ["whatsapp_from_number"],
        unique=True,
        postgresql_where=sa.text("whatsapp_from_number IS NOT NULL"),
    )
    op.create_index(
        "uq_system_departments_wati_webhook_secret",
        "system_departments",
        ["wati_webhook_secret"],
        unique=True,
        postgresql_where=sa.text("wati_webhook_secret IS NOT NULL"),
    )

    op.create_table(
        "system_whatsapp_conversations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("agent_id", sa.Integer(), sa.ForeignKey("system_agents.id"), nullable=False),
        sa.Column("from_number", sa.String(length=32), nullable=False),
        sa.Column("to_number", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("from_number", "to_number", name="uq_whatsapp_conversations_from_to"),
    )
    op.create_index(
        "ix_system_whatsapp_conversations_agent_id",
        "system_whatsapp_conversations",
        ["agent_id"],
    )
    op.create_index(
        "ix_system_whatsapp_conversations_from_number",
        "system_whatsapp_conversations",
        ["from_number"],
    )
    op.create_index(
        "ix_system_whatsapp_conversations_to_number",
        "system_whatsapp_conversations",
        ["to_number"],
    )

    op.create_table(
        "system_whatsapp_messages",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "conversation_id",
            sa.Integer(),
            sa.ForeignKey("system_whatsapp_conversations.id"),
            nullable=False,
        ),
        sa.Column(
            "direction",
            sa.Enum("inbound", "outbound", name="whatsappmessagedirection"),
            nullable=False,
        ),
        sa.Column("body", sa.Text(), nullable=False, server_default=""),
        sa.Column("wati_message_id", sa.String(length=256), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index(
        "ix_system_whatsapp_messages_conversation_id",
        "system_whatsapp_messages",
        ["conversation_id"],
    )
    op.create_index(
        "uq_system_whatsapp_messages_wati_message_id",
        "system_whatsapp_messages",
        ["wati_message_id"],
        unique=True,
        postgresql_where=sa.text("wati_message_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_system_whatsapp_messages_wati_message_id", table_name="system_whatsapp_messages")
    op.drop_index("ix_system_whatsapp_messages_conversation_id", table_name="system_whatsapp_messages")
    op.drop_table("system_whatsapp_messages")
    op.execute("DROP TYPE IF EXISTS whatsappmessagedirection")

    op.drop_index("ix_system_whatsapp_conversations_to_number", table_name="system_whatsapp_conversations")
    op.drop_index("ix_system_whatsapp_conversations_from_number", table_name="system_whatsapp_conversations")
    op.drop_index("ix_system_whatsapp_conversations_agent_id", table_name="system_whatsapp_conversations")
    op.drop_table("system_whatsapp_conversations")

    op.drop_index("uq_system_departments_wati_webhook_secret", table_name="system_departments")
    op.drop_index("uq_system_departments_whatsapp_from_number", table_name="system_departments")
    op.drop_column("system_departments", "wati_webhook_secret")
    op.drop_column("system_departments", "wati_api_token")
    op.drop_column("system_departments", "wati_api_endpoint")
    op.drop_column("system_departments", "whatsapp_from_number")
