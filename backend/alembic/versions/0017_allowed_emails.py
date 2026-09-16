"""allowed login emails table

Revision ID: 0017
"""
import json
import re

from alembic import op
import sqlalchemy as sa

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def upgrade() -> None:
    op.create_table(
        "system_allowed_emails",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("email", sa.String(length=254), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index(
        "ix_system_allowed_emails_email",
        "system_allowed_emails",
        ["email"],
        unique=True,
    )

    conn = op.get_bind()
    row = conn.execute(
        sa.text("SELECT value FROM system_params WHERE key = :key"),
        {"key": "ALLOWED_EMAILS"},
    ).first()
    if row and row[0]:
        parsed = json.loads(row[0])
        emails = []
        if isinstance(parsed, list):
            seen: set[str] = set()
            for item in parsed:
                email = str(item).strip().lower()
                if not EMAIL_RE.fullmatch(email) or email in seen:
                    continue
                seen.add(email)
                emails.append(email)
        for email in emails:
            conn.execute(
                sa.text("INSERT INTO system_allowed_emails (email) VALUES (:email)"),
                {"email": email},
            )
    conn.execute(
        sa.text("DELETE FROM system_params WHERE key = :key"),
        {"key": "ALLOWED_EMAILS"},
    )


def downgrade() -> None:
    conn = op.get_bind()
    emails = [
        row[0]
        for row in conn.execute(sa.text("SELECT email FROM system_allowed_emails ORDER BY id"))
    ]
    conn.execute(
        sa.text(
            "INSERT INTO system_params (key, value, description) "
            "VALUES (:key, :value, :description)"
        ),
        {
            "key": "ALLOWED_EMAILS",
            "value": json.dumps(emails),
            "description": "JSON array of emails permitted to log in",
        },
    )
    op.drop_index("ix_system_allowed_emails_email", table_name="system_allowed_emails")
    op.drop_table("system_allowed_emails")
