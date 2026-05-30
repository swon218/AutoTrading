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

-- Supabase watchlist storage.
-- Run this in the Supabase SQL editor for the project used by js/frontend/supabaseClient.js.

CREATE TABLE IF NOT EXISTS public.watchlist_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 40),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.watchlist_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES public.watchlist_groups(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    stock_code VARCHAR(12) NOT NULL,
    stock_name TEXT NOT NULL,
    source_type VARCHAR(40) NOT NULL DEFAULT 'manual',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT watchlist_items_stock_code_check CHECK (stock_code ~ '^[A-Za-z0-9_]+$')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_watchlist_groups_user_name
    ON public.watchlist_groups (user_id, lower(name));

CREATE INDEX IF NOT EXISTS idx_watchlist_groups_user_created
    ON public.watchlist_groups (user_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_watchlist_items_group_code
    ON public.watchlist_items (group_id, stock_code);

CREATE INDEX IF NOT EXISTS idx_watchlist_items_group_order
    ON public.watchlist_items (group_id, sort_order);

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.touch_watchlist_group_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.watchlist_groups
       SET updated_at = NOW()
     WHERE id = CASE
         WHEN TG_OP = 'DELETE' THEN OLD.group_id
         ELSE NEW.group_id
     END;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_watchlist_groups_touch_updated_at
    ON public.watchlist_groups;

CREATE TRIGGER trg_watchlist_groups_touch_updated_at
BEFORE UPDATE ON public.watchlist_groups
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_watchlist_items_touch_group_insert
    ON public.watchlist_items;

CREATE TRIGGER trg_watchlist_items_touch_group_insert
AFTER INSERT ON public.watchlist_items
FOR EACH ROW
EXECUTE FUNCTION public.touch_watchlist_group_updated_at();

DROP TRIGGER IF EXISTS trg_watchlist_items_touch_group_update
    ON public.watchlist_items;

CREATE TRIGGER trg_watchlist_items_touch_group_update
AFTER UPDATE ON public.watchlist_items
FOR EACH ROW
EXECUTE FUNCTION public.touch_watchlist_group_updated_at();

DROP TRIGGER IF EXISTS trg_watchlist_items_touch_group_delete
    ON public.watchlist_items;

CREATE TRIGGER trg_watchlist_items_touch_group_delete
AFTER DELETE ON public.watchlist_items
FOR EACH ROW
EXECUTE FUNCTION public.touch_watchlist_group_updated_at();

ALTER TABLE public.watchlist_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.watchlist_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS watchlist_groups_owner_select ON public.watchlist_groups;
CREATE POLICY watchlist_groups_owner_select
    ON public.watchlist_groups
    FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS watchlist_groups_owner_insert ON public.watchlist_groups;
CREATE POLICY watchlist_groups_owner_insert
    ON public.watchlist_groups
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS watchlist_groups_owner_update ON public.watchlist_groups;
CREATE POLICY watchlist_groups_owner_update
    ON public.watchlist_groups
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS watchlist_groups_owner_delete ON public.watchlist_groups;
CREATE POLICY watchlist_groups_owner_delete
    ON public.watchlist_groups
    FOR DELETE
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS watchlist_items_owner_select ON public.watchlist_items;
CREATE POLICY watchlist_items_owner_select
    ON public.watchlist_items
    FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS watchlist_items_owner_insert ON public.watchlist_items;
CREATE POLICY watchlist_items_owner_insert
    ON public.watchlist_items
    FOR INSERT
    WITH CHECK (
        auth.uid() = user_id
        AND EXISTS (
            SELECT 1
              FROM public.watchlist_groups g
             WHERE g.id = group_id
               AND g.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS watchlist_items_owner_update ON public.watchlist_items;
CREATE POLICY watchlist_items_owner_update
    ON public.watchlist_items
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (
        auth.uid() = user_id
        AND EXISTS (
            SELECT 1
              FROM public.watchlist_groups g
             WHERE g.id = group_id
               AND g.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS watchlist_items_owner_delete ON public.watchlist_items;
CREATE POLICY watchlist_items_owner_delete
    ON public.watchlist_items
    FOR DELETE
    USING (auth.uid() = user_id);

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE
ON public.watchlist_groups
TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
ON public.watchlist_items
TO authenticated;

GRANT ALL
ON public.watchlist_groups
TO service_role;

GRANT ALL
ON public.watchlist_items
TO service_role;
