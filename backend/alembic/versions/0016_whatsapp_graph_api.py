"""replace WATI credentials with Meta Graph API WhatsApp Cloud API fields

Revision ID: 0016
"""
from alembic import op
import sqlalchemy as sa

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index("uq_system_departments_wati_webhook_secret", table_name="system_departments")
    op.drop_column("system_departments", "wati_webhook_secret")
    op.drop_column("system_departments", "wati_api_token")
    op.drop_column("system_departments", "wati_api_endpoint")

    op.add_column("system_departments", sa.Column("whatsapp_phone_number_id", sa.String(length=64), nullable=True))
    op.add_column("system_departments", sa.Column("whatsapp_access_token", sa.String(length=4096), nullable=True))
    op.add_column("system_departments", sa.Column("whatsapp_webhook_secret", sa.String(length=64), nullable=True))
    op.add_column("system_departments", sa.Column("whatsapp_verify_token", sa.String(length=64), nullable=True))
    op.create_index(
        "uq_system_departments_whatsapp_phone_number_id",
        "system_departments",
        ["whatsapp_phone_number_id"],
        unique=True,
        postgresql_where=sa.text("whatsapp_phone_number_id IS NOT NULL"),
    )
    op.create_index(
        "uq_system_departments_whatsapp_webhook_secret",
        "system_departments",
        ["whatsapp_webhook_secret"],
        unique=True,
        postgresql_where=sa.text("whatsapp_webhook_secret IS NOT NULL"),
    )

    op.drop_index("uq_system_whatsapp_messages_wati_message_id", table_name="system_whatsapp_messages")
    op.alter_column(
        "system_whatsapp_messages",
        "wati_message_id",
        new_column_name="whatsapp_message_id",
    )
    op.create_index(
        "uq_system_whatsapp_messages_whatsapp_message_id",
        "system_whatsapp_messages",
        ["whatsapp_message_id"],
        unique=True,
        postgresql_where=sa.text("whatsapp_message_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_system_whatsapp_messages_whatsapp_message_id", table_name="system_whatsapp_messages")
    op.alter_column(
        "system_whatsapp_messages",
        "whatsapp_message_id",
        new_column_name="wati_message_id",
    )
    op.create_index(
        "uq_system_whatsapp_messages_wati_message_id",
        "system_whatsapp_messages",
        ["wati_message_id"],
        unique=True,
        postgresql_where=sa.text("wati_message_id IS NOT NULL"),
    )

    op.drop_index("uq_system_departments_whatsapp_webhook_secret", table_name="system_departments")
    op.drop_index("uq_system_departments_whatsapp_phone_number_id", table_name="system_departments")
    op.drop_column("system_departments", "whatsapp_verify_token")
    op.drop_column("system_departments", "whatsapp_webhook_secret")
    op.drop_column("system_departments", "whatsapp_access_token")
    op.drop_column("system_departments", "whatsapp_phone_number_id")

    op.add_column("system_departments", sa.Column("wati_api_endpoint", sa.String(length=256), nullable=True))
    op.add_column("system_departments", sa.Column("wati_api_token", sa.String(length=2048), nullable=True))
    op.add_column("system_departments", sa.Column("wati_webhook_secret", sa.String(length=64), nullable=True))
    op.create_index(
        "uq_system_departments_wati_webhook_secret",
        "system_departments",
        ["wati_webhook_secret"],
        unique=True,
        postgresql_where=sa.text("wati_webhook_secret IS NOT NULL"),
    )
