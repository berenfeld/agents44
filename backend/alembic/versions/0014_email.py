"""department email conf and outbound email messages

Revision ID: 0014
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "system_email_conf",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("department_id", sa.Integer(), sa.ForeignKey("system_departments.id"), nullable=False),
        sa.Column("email_address", sa.String(length=254), nullable=False),
        sa.Column("app_password", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("department_id", name="uq_system_email_conf_department_id"),
        sa.UniqueConstraint("email_address", name="uq_system_email_conf_email_address"),
    )
    op.create_index("ix_system_email_conf_department_id", "system_email_conf", ["department_id"])

    op.create_table(
        "system_email_messages",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("agent_id", sa.Integer(), sa.ForeignKey("system_agents.id"), nullable=False),
        sa.Column("from_email", sa.String(length=254), nullable=False),
        sa.Column("subject", sa.String(length=998), nullable=False, server_default=""),
        sa.Column("recipients", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("cc", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("bcc", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("message", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "content_type",
            sa.Enum("html", "plain", name="emailcontenttype"),
            nullable=False,
            server_default="html",
        ),
        sa.Column(
            "sending_status",
            sa.Enum("pending", "sent", "fail", "canceled", name="emailsendingstatus"),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_message", sa.Text(), nullable=True),
    )
    op.create_index("ix_system_email_messages_agent_id", "system_email_messages", ["agent_id"])
    op.create_index("ix_system_email_messages_from_email", "system_email_messages", ["from_email"])
    op.create_index("ix_system_email_messages_sending_status", "system_email_messages", ["sending_status"])
    op.create_index("ix_system_email_messages_created_at", "system_email_messages", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_system_email_messages_created_at", table_name="system_email_messages")
    op.drop_index("ix_system_email_messages_sending_status", table_name="system_email_messages")
    op.drop_index("ix_system_email_messages_from_email", table_name="system_email_messages")
    op.drop_index("ix_system_email_messages_agent_id", table_name="system_email_messages")
    op.drop_table("system_email_messages")
    op.execute("DROP TYPE IF EXISTS emailsendingstatus")
    op.execute("DROP TYPE IF EXISTS emailcontenttype")

    op.drop_index("ix_system_email_conf_department_id", table_name="system_email_conf")
    op.drop_table("system_email_conf")
