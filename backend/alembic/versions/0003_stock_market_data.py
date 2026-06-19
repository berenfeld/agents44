"""stock market data tables

Revision ID: 0003
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def _table_names() -> set[str]:
    return set(inspect(op.get_bind()).get_table_names())


def _index_names(table: str) -> set[str]:
    return {idx["name"] for idx in inspect(op.get_bind()).get_indexes(table)}


def _unique_constraint_names(table: str) -> set[str]:
    return {uc["name"] for uc in inspect(op.get_bind()).get_unique_constraints(table)}


def upgrade() -> None:
    tables = _table_names()

    if "stocks" not in tables:
        op.create_table(
            "stocks",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("symbol", sa.String(length=10), nullable=False, unique=True),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("sector", sa.String(length=100), nullable=True),
            sa.Column("listing_date", sa.DateTime(timezone=True), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        )

    if "ix_stocks_symbol" not in _index_names("stocks"):
        op.create_index("ix_stocks_symbol", "stocks", ["symbol"], unique=True)

    if "stock_prices" not in tables:
        op.create_table(
            "stock_prices",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("stock_id", sa.Integer(), sa.ForeignKey("stocks.id"), nullable=False),
            sa.Column("trading_date", sa.Date(), nullable=False),
            sa.Column("open_price", sa.Numeric(12, 2), nullable=True),
            sa.Column("high_price", sa.Numeric(12, 2), nullable=True),
            sa.Column("low_price", sa.Numeric(12, 2), nullable=True),
            sa.Column("close_price", sa.Numeric(12, 2), nullable=False),
            sa.Column("volume", sa.Integer(), nullable=True),
            sa.Column("adjusted_close", sa.Numeric(12, 2), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        )

    if "ix_stock_prices_stock_id" not in _index_names("stock_prices"):
        op.create_index("ix_stock_prices_stock_id", "stock_prices", ["stock_id"])
    if "ix_stock_prices_trading_date" not in _index_names("stock_prices"):
        op.create_index("ix_stock_prices_trading_date", "stock_prices", ["trading_date"])
    if "uq_stock_prices_stock_id_trading_date" not in _unique_constraint_names("stock_prices"):
        op.create_unique_constraint(
            "uq_stock_prices_stock_id_trading_date",
            "stock_prices",
            ["stock_id", "trading_date"],
        )


def downgrade() -> None:
    tables = _table_names()
    if "stock_prices" in tables:
        if "uq_stock_prices_stock_id_trading_date" in _unique_constraint_names("stock_prices"):
            op.drop_constraint("uq_stock_prices_stock_id_trading_date", "stock_prices", type_="unique")
        if "ix_stock_prices_trading_date" in _index_names("stock_prices"):
            op.drop_index("ix_stock_prices_trading_date", "stock_prices")
        if "ix_stock_prices_stock_id" in _index_names("stock_prices"):
            op.drop_index("ix_stock_prices_stock_id", "stock_prices")
        op.drop_table("stock_prices")
    if "stocks" in tables:
        if "ix_stocks_symbol" in _index_names("stocks"):
            op.drop_index("ix_stocks_symbol", "stocks")
        op.drop_table("stocks")
