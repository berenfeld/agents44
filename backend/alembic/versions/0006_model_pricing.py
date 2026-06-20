"""update MODEL_PRICING for current Claude models

Revision ID: 0006
"""
import json

from alembic import op
import sqlalchemy as sa

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None

MODEL_PRICING_KEY = "MODEL_PRICING"

NEW_MODEL_PRICING = {
    "claude-fable-5": {"input_per_million": 10.0, "output_per_million": 50.0},
    "claude-opus-4-8": {"input_per_million": 5.0, "output_per_million": 25.0},
    "claude-opus-4-7": {"input_per_million": 5.0, "output_per_million": 25.0},
    "claude-opus-4-6": {"input_per_million": 5.0, "output_per_million": 25.0},
    "claude-opus-4-5-20251101": {"input_per_million": 5.0, "output_per_million": 25.0},
    "claude-opus-4-1-20250805": {"input_per_million": 15.0, "output_per_million": 75.0},
    "claude-sonnet-4-6": {"input_per_million": 3.0, "output_per_million": 15.0},
    "claude-sonnet-4-5-20250929": {"input_per_million": 3.0, "output_per_million": 15.0},
    "claude-haiku-4-5-20251001": {"input_per_million": 1.0, "output_per_million": 5.0},
}

OLD_MODEL_PRICING = {
    "claude-sonnet-4-20250514": {"input_per_million": 3.0, "output_per_million": 15.0},
    "claude-3-5-sonnet-20241022": {"input_per_million": 3.0, "output_per_million": 15.0},
}


def upgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        sa.text(
            "UPDATE system_params SET value = :value WHERE key = :key"
        ),
        {"key": MODEL_PRICING_KEY, "value": json.dumps(NEW_MODEL_PRICING)},
    )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        sa.text(
            "UPDATE system_params SET value = :value WHERE key = :key"
        ),
        {"key": MODEL_PRICING_KEY, "value": json.dumps(OLD_MODEL_PRICING)},
    )
