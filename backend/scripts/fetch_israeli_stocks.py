#!/usr/bin/env python
"""
Script to fetch Israeli stock market data and populate the database.
Fetches daily OHLCV data for major Israeli stocks from Yahoo Finance.
"""

import sys
from datetime import datetime, timedelta
from pathlib import Path
import pandas as pd

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app import create_app
from app.extensions import db
from app.models import Stock, StockPrice

# List of major Israeli companies listed on US exchanges (NASDAQ/NYSE)
# These are more reliably available on Yahoo Finance
ISRAELI_STOCKS = [
    {"symbol": "TEVA", "name": "Teva Pharmaceutical Industries", "sector": "Pharmaceuticals"},
    {"symbol": "WIX", "name": "Wix.com Ltd", "sector": "Technology"},
    {"symbol": "CHKP", "name": "Check Point Software Technologies", "sector": "Technology"},
    {"symbol": "NICE", "name": "NICE Systems", "sector": "Technology"},
    {"symbol": "MRVL", "name": "Marvell Technology (Israeli founded)", "sector": "Technology"},
    {"symbol": "CRWD", "name": "CrowdStrike (Israeli co-founder)", "sector": "Cybersecurity"},
    {"symbol": "DXCM", "name": "DexCom (Israeli founders)", "sector": "Medical Devices"},
    {"symbol": "MNST", "name": "Monster Beverage", "sector": "Beverages"},
    {"symbol": "CYBR", "name": "CyberArk Software", "sector": "Cybersecurity"},
    {"symbol": "SQ", "name": "Square Inc (Israeli connections)", "sector": "Technology"},
]


def add_stocks_to_db():
    """Add Israeli stocks to the database."""
    app = create_app()
    with app.app_context():
        for stock_data in ISRAELI_STOCKS:
            # Check if stock already exists
            existing = Stock.query.filter_by(symbol=stock_data["symbol"]).first()
            if not existing:
                stock = Stock(
                    symbol=stock_data["symbol"],
                    name=stock_data["name"],
                    sector=stock_data["sector"],
                    is_active=True,
                )
                db.session.add(stock)
                print(f"Added stock: {stock_data['symbol']} - {stock_data['name']}")
            else:
                print(f"Stock already exists: {stock_data['symbol']}")

        db.session.commit()
        print(f"\nTotal stocks in database: {Stock.query.count()}")


def fetch_and_populate_historical_data():
    """
    Fetch historical data for Israeli stocks.
    Using yfinance to get data from Yahoo Finance.
    """
    try:
        import yfinance as yf
    except ImportError:
        print("yfinance not installed. Installing...")
        import subprocess
        subprocess.check_call([sys.executable, "-m", "pip", "install", "yfinance"])
        import yfinance as yf

    app = create_app()
    with app.app_context():
        stocks = Stock.query.all()

        # Fetch last 10 years of data
        end_date = datetime.now()
        start_date = end_date - timedelta(days=365 * 10)

        for stock in stocks:
            print(f"\nFetching data for {stock.symbol}...")

            try:
                # Fetch historical data using ticker object
                ticker = yf.Ticker(stock.symbol)
                data = ticker.history(start=start_date, end=end_date)

                if data.empty:
                    print(f"  No data found for {stock.symbol}")
                    continue

                # Count existing prices to avoid duplicates
                existing_count = StockPrice.query.filter_by(stock_id=stock.id).count()

                # Insert data into database
                added_count = 0
                for date_index, row in data.iterrows():
                    # Convert timezone-aware datetime to date
                    if hasattr(date_index, 'date'):
                        trading_date = date_index.date()
                    else:
                        trading_date = date_index.astype('datetime64[D]').astype(object)

                    # Check if price already exists for this date
                    existing_price = StockPrice.query.filter_by(
                        stock_id=stock.id,
                        trading_date=trading_date
                    ).first()

                    if not existing_price:
                        price = StockPrice(
                            stock_id=stock.id,
                            trading_date=trading_date,
                            open_price=float(row["Open"]) if not pd.isna(row["Open"]) else None,
                            high_price=float(row["High"]) if not pd.isna(row["High"]) else None,
                            low_price=float(row["Low"]) if not pd.isna(row["Low"]) else None,
                            close_price=float(row["Close"]),
                            volume=int(row["Volume"]) if not pd.isna(row["Volume"]) and row["Volume"] > 0 else None,
                            adjusted_close=float(row["Close"]),  # Use Close as Adj Close for now
                        )
                        db.session.add(price)
                        added_count += 1

                db.session.commit()
                print(f"  Added {added_count} price records (already had {existing_count})")

            except Exception as e:
                print(f"  Error fetching data for {stock.symbol}: {str(e)}")
                import traceback
                traceback.print_exc()
                db.session.rollback()
                continue


def print_summary():
    """Print summary of what was loaded."""
    app = create_app()
    with app.app_context():
        stock_count = Stock.query.count()
        price_count = StockPrice.query.count()

        print("\n" + "=" * 50)
        print("Database Summary:")
        print("=" * 50)
        print(f"Total stocks: {stock_count}")
        print(f"Total price records: {price_count}")

        # Show breakdown by stock
        print("\nBreakdown by stock:")
        for stock in Stock.query.order_by(Stock.symbol).all():
            price_count = StockPrice.query.filter_by(stock_id=stock.id).count()
            print(f"  {stock.symbol}: {price_count} price records")


if __name__ == "__main__":
    print("Israeli Stock Market Data Collection Script")
    print("=" * 50)

    print("\n1. Adding stocks to database...")
    add_stocks_to_db()

    print("\n2. Fetching historical data (this may take a few minutes)...")
    fetch_and_populate_historical_data()

    print_summary()

    print("\nDone!")
