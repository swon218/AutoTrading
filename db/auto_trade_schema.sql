-- Auto trade settings and event log.
-- Run this in the Supabase SQL editor.

ALTER TABLE public.user_api_credentials
    ADD COLUMN IF NOT EXISTS telegram_chat_id_encrypted TEXT;

ALTER TABLE public.user_api_credentials
    ADD COLUMN IF NOT EXISTS telegram_verified_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.auto_trade_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    stock_code VARCHAR(12) NOT NULL,
    stock_name TEXT NOT NULL DEFAULT '',
    strategy_id UUID NOT NULL REFERENCES public.strategies(id) ON DELETE CASCADE,
    is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    max_buy_price NUMERIC(18, 4),
    min_buy_price NUMERIC(18, 4),
    order_quantity INTEGER,
    order_amount NUMERIC(18, 0),
    cash_guard_agreed BOOLEAN NOT NULL DEFAULT FALSE,
    telegram_alert_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    auto_order_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    last_signal_at TIMESTAMPTZ,
    last_order_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT auto_trade_rules_stock_code_check CHECK (stock_code ~ '^[A-Za-z0-9_]+$'),
    CONSTRAINT auto_trade_rules_order_quantity_check CHECK (order_quantity IS NULL OR order_quantity > 0),
    CONSTRAINT auto_trade_rules_order_amount_check CHECK (order_amount IS NULL OR order_amount > 0),
    CONSTRAINT auto_trade_rules_max_buy_price_check CHECK (max_buy_price IS NULL OR max_buy_price > 0),
    CONSTRAINT auto_trade_rules_min_buy_price_check CHECK (min_buy_price IS NULL OR min_buy_price > 0),
    CONSTRAINT auto_trade_rules_order_input_check CHECK (order_quantity IS NOT NULL OR order_amount IS NOT NULL)
);

ALTER TABLE public.auto_trade_rules
    ADD COLUMN IF NOT EXISTS min_buy_price NUMERIC(18, 4);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'auto_trade_rules_min_buy_price_check'
    ) THEN
        ALTER TABLE public.auto_trade_rules
            ADD CONSTRAINT auto_trade_rules_min_buy_price_check
            CHECK (min_buy_price IS NULL OR min_buy_price > 0);
    END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_auto_trade_rules_user_stock_strategy
    ON public.auto_trade_rules (user_id, stock_code, strategy_id);

CREATE INDEX IF NOT EXISTS idx_auto_trade_rules_user_created
    ON public.auto_trade_rules (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auto_trade_rules_enabled
    ON public.auto_trade_rules (is_enabled, stock_code)
    WHERE is_enabled = TRUE;

CREATE TABLE IF NOT EXISTS public.auto_trade_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    rule_id UUID REFERENCES public.auto_trade_rules(id) ON DELETE SET NULL,
    stock_code VARCHAR(12) NOT NULL,
    event_type TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    price NUMERIC(18, 4),
    quantity INTEGER,
    order_amount NUMERIC(18, 0),
    raw_payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT auto_trade_events_stock_code_check CHECK (stock_code ~ '^[A-Za-z0-9_]+$')
);

CREATE INDEX IF NOT EXISTS idx_auto_trade_events_user_created
    ON public.auto_trade_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auto_trade_events_rule_created
    ON public.auto_trade_events (rule_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.touch_auto_trade_rule_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auto_trade_rules_touch_updated_at
    ON public.auto_trade_rules;

CREATE TRIGGER trg_auto_trade_rules_touch_updated_at
BEFORE UPDATE ON public.auto_trade_rules
FOR EACH ROW
EXECUTE FUNCTION public.touch_auto_trade_rule_updated_at();

ALTER TABLE public.auto_trade_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_trade_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auto_trade_rules_owner_select ON public.auto_trade_rules;
CREATE POLICY auto_trade_rules_owner_select
    ON public.auto_trade_rules
    FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS auto_trade_rules_owner_insert ON public.auto_trade_rules;
CREATE POLICY auto_trade_rules_owner_insert
    ON public.auto_trade_rules
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS auto_trade_rules_owner_update ON public.auto_trade_rules;
CREATE POLICY auto_trade_rules_owner_update
    ON public.auto_trade_rules
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS auto_trade_rules_owner_delete ON public.auto_trade_rules;
CREATE POLICY auto_trade_rules_owner_delete
    ON public.auto_trade_rules
    FOR DELETE
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS auto_trade_events_owner_select ON public.auto_trade_events;
CREATE POLICY auto_trade_events_owner_select
    ON public.auto_trade_events
    FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS auto_trade_events_owner_insert ON public.auto_trade_events;
CREATE POLICY auto_trade_events_owner_insert
    ON public.auto_trade_events
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE
ON public.auto_trade_rules
TO authenticated;

GRANT SELECT, INSERT
ON public.auto_trade_events
TO authenticated;

GRANT ALL
ON public.auto_trade_rules
TO service_role;

GRANT ALL
ON public.auto_trade_events
TO service_role;
