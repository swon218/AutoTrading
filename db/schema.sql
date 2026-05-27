-- AutoTrading local PostgreSQL schema draft
-- Purpose: store Kiwoom REST 15-minute candles locally, then aggregate to 30m/1h/2h in the backend.

CREATE SCHEMA IF NOT EXISTS market_data;

CREATE TABLE IF NOT EXISTS market_data.stock_candles_15m (
    stock_code VARCHAR(12) NOT NULL,
    candle_time TIMESTAMPTZ NOT NULL,
    open_price NUMERIC(18, 4) NOT NULL,
    high_price NUMERIC(18, 4) NOT NULL,
    low_price NUMERIC(18, 4) NOT NULL,
    close_price NUMERIC(18, 4) NOT NULL,
    volume BIGINT NOT NULL DEFAULT 0,
    trade_value NUMERIC(24, 0),
    source_api_id VARCHAR(20) NOT NULL DEFAULT 'ka10080',
    tic_scope SMALLINT NOT NULL DEFAULT 15,
    adjusted_price_type CHAR(1) NOT NULL DEFAULT '1',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (stock_code, candle_time),
    CONSTRAINT stock_candles_15m_tic_scope_check CHECK (tic_scope = 15),
    CONSTRAINT stock_candles_15m_price_check CHECK (
        high_price >= low_price
        AND high_price >= open_price
        AND high_price >= close_price
        AND low_price <= open_price
        AND low_price <= close_price
    )
);

CREATE INDEX IF NOT EXISTS idx_stock_candles_15m_time
    ON market_data.stock_candles_15m (candle_time);

CREATE INDEX IF NOT EXISTS idx_stock_candles_15m_stock_time_desc
    ON market_data.stock_candles_15m (stock_code, candle_time DESC);

-- Helpful for large append-mostly candle tables.
CREATE INDEX IF NOT EXISTS brin_stock_candles_15m_time
    ON market_data.stock_candles_15m USING BRIN (candle_time);

CREATE OR REPLACE FUNCTION market_data.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stock_candles_15m_touch_updated_at
    ON market_data.stock_candles_15m;

CREATE TRIGGER trg_stock_candles_15m_touch_updated_at
BEFORE UPDATE ON market_data.stock_candles_15m
FOR EACH ROW
EXECUTE FUNCTION market_data.touch_updated_at();

COMMENT ON TABLE market_data.stock_candles_15m IS
    'Kiwoom REST ka10080 15-minute OHLCV candles. Backend aggregates this table to 30m, 1h, and 2h charts.';

COMMENT ON COLUMN market_data.stock_candles_15m.stock_code IS 'Kiwoom stock code without leading A prefix.';
COMMENT ON COLUMN market_data.stock_candles_15m.candle_time IS '15-minute candle start time in Korea market time.';
COMMENT ON COLUMN market_data.stock_candles_15m.adjusted_price_type IS 'Kiwoom upd_stkpc_tp value. 1 means adjusted price.';

