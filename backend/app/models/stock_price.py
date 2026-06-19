from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.extensions import db

if TYPE_CHECKING:
    from app.models.stock import Stock


class StockPrice(db.Model):
    __tablename__ = "stock_prices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    stock_id: Mapped[int] = mapped_column(Integer, ForeignKey("stocks.id"), nullable=False, index=True)
    trading_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    open_price: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    high_price: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    low_price: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    close_price: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    volume: Mapped[int | None] = mapped_column(Integer, nullable=True)
    adjusted_close: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    stock: Mapped["Stock"] = relationship(back_populates="prices")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "stock_id": self.stock_id,
            "trading_date": self.trading_date.isoformat() if self.trading_date else None,
            "open_price": float(self.open_price) if self.open_price else None,
            "high_price": float(self.high_price) if self.high_price else None,
            "low_price": float(self.low_price) if self.low_price else None,
            "close_price": float(self.close_price) if self.close_price else None,
            "volume": self.volume,
            "adjusted_close": float(self.adjusted_close) if self.adjusted_close else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
