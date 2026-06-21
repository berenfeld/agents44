"""add timeout grace system params

Revision ID: 0009
"""
from alembic import op
import sqlalchemy as sa

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None

NEW_PARAMS = [
    {
        "key": "TIMEOUT_SIGTERM_GRACE_SECONDS",
        "value": "300",
        "description": (
            "Seconds after an agent's configured timeout before SIGTERM is sent "
            "(default 300 = 5 minutes)."
        ),
    },
    {
        "key": "TIMEOUT_SIGKILL_GRACE_SECONDS",
        "value": "600",
        "description": (
            "Seconds after an agent's configured timeout before SIGKILL is sent "
            "(default 600 = 10 minutes). Must be >= TIMEOUT_SIGTERM_GRACE_SECONDS."
        ),
    },
]


def upgrade() -> None:
    conn = op.get_bind()
    for item in NEW_PARAMS:
        exists = conn.execute(
            sa.text("SELECT 1 FROM system_params WHERE key = :key"),
            {"key": item["key"]},
        ).first()
        if exists:
            continue
        conn.execute(
            sa.text(
                "INSERT INTO system_params (key, value, description) "
                "VALUES (:key, :value, :description)"
            ),
            item,
        )


def downgrade() -> None:
    conn = op.get_bind()
    for item in NEW_PARAMS:
        conn.execute(
            sa.text("DELETE FROM system_params WHERE key = :key"),
            {"key": item["key"]},
        )
