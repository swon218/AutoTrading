const { getOrderableCash } = require('./account');
const { getChartData } = require('./charts');
const { isRegularMarketTime, placeStockOrder } = require('./orders');
const { getStockInfo } = require('./stocks');
const { evaluateStrategy } = require('./strategyEvaluator');
const { sendTelegramMessage } = require('./telegram');
const {
    getBackendSupabaseConfig,
    getUserKiwoomCredentialsById,
    requestSupabaseJson,
} = require('./userCredentials');

const DEFAULT_POLL_MS = 60 * 1000;
const CHART_INTERVAL = '15';
const CHART_LIMIT = 240;

let timer = null;
let running = false;
let lastRunAt = null;
let lastError = '';

function getHeaders(config) {
    return {
        apikey: config.serviceKey,
        Authorization: `Bearer ${config.serviceKey}`,
        'Content-Type': 'application/json',
    };
}

function normalizeNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

async function getEnabledRules(config) {
    return requestSupabaseJson(
        `${config.url}/rest/v1/auto_trade_rules?is_enabled=eq.true&select=*,strategies(id,name,config_json)&order=updated_at.asc`,
        { headers: getHeaders(config) },
    );
}

async function insertEvent(config, rule, eventType, message, extra = {}) {
    await requestSupabaseJson(`${config.url}/rest/v1/auto_trade_events`, {
        method: 'POST',
        headers: getHeaders(config),
        body: JSON.stringify({
            user_id: rule.user_id,
            rule_id: rule.id,
            stock_code: rule.stock_code,
            event_type: eventType,
            message,
            price: extra.price ?? null,
            quantity: extra.quantity ?? null,
            order_amount: extra.orderAmount ?? null,
            raw_payload: extra.rawPayload ?? null,
        }),
    });
}

async function updateRule(config, ruleId, patch) {
    await requestSupabaseJson(
        `${config.url}/rest/v1/auto_trade_rules?id=eq.${encodeURIComponent(ruleId)}`,
        {
            method: 'PATCH',
            headers: getHeaders(config),
            body: JSON.stringify({
                ...patch,
                updated_at: new Date().toISOString(),
            }),
        },
    );
}

function buildTelegramMessage(rule, price, evaluation, orderResult = null) {
    const stockName = rule.stock_name || rule.stock_code;
    const strategyName = rule.strategies?.name || 'saved strategy';
    const lines = [
        `[AutoTrading] ${stockName}(${rule.stock_code})`,
        `Strategy: ${strategyName}`,
        `Price: ${Math.round(price).toLocaleString('ko-KR')} KRW`,
        `Signal: ${evaluation.details.join(', ') || evaluation.reason}`,
    ];

    if (orderResult) {
        lines.push(`Order: ${orderResult.orderNo ? `accepted ${orderResult.orderNo}` : 'requested'}`);
    }

    return lines.join('\n');
}

function shouldSkipSameCandle(rule, latestCandleTime) {
    if (!rule.last_signal_at || !latestCandleTime) return false;
    return new Date(rule.last_signal_at).getTime() >= new Date(latestCandleTime).getTime();
}

async function processRule(config, rule) {
    const credentials = await getUserKiwoomCredentialsById(rule.user_id);
    if (!credentials?.appkey || !credentials?.secretkey) {
        await insertEvent(config, rule, 'skipped', 'Kiwoom credentials are missing.');
        return;
    }
    if (!credentials.telegramBotToken || !credentials.telegramChatId) {
        await insertEvent(config, rule, 'skipped', 'Telegram credentials are missing.');
        return;
    }

    const chart = await getChartData(rule.stock_code, CHART_INTERVAL, credentials, { limit: CHART_LIMIT });
    const candles = Array.isArray(chart.candles) ? chart.candles : [];
    const latestCandle = candles[candles.length - 1];
    if (!latestCandle) {
        await insertEvent(config, rule, 'skipped', 'No chart candles.');
        return;
    }
    if (shouldSkipSameCandle(rule, latestCandle.time)) return;

    const evaluation = evaluateStrategy(rule.strategies?.config_json, candles);
    if (!evaluation.matched) return;

    const stock = await getStockInfo(rule.stock_code, credentials);
    const price = normalizeNumber(stock.price || latestCandle.close);
    const maxBuyPrice = normalizeNumber(rule.max_buy_price);
    const minBuyPrice = normalizeNumber(rule.min_buy_price);
    const quantity = Math.floor(normalizeNumber(rule.order_quantity));
    const orderAmount = price * quantity;

    await updateRule(config, rule.id, { last_signal_at: latestCandle.time });

    if (maxBuyPrice > 0 && price > maxBuyPrice) {
        const message = `Signal matched but price ${price} is above max buy price ${maxBuyPrice}.`;
        await insertEvent(config, rule, 'blocked', message, { price, quantity, orderAmount });
        await sendTelegramMessage(credentials.telegramBotToken, credentials.telegramChatId, `${buildTelegramMessage(rule, price, evaluation)}\nBlocked: above max buy price.`);
        return;
    }
    if (minBuyPrice > 0 && price < minBuyPrice) {
        const message = `Signal matched but price ${price} is below min buy price ${minBuyPrice}.`;
        await insertEvent(config, rule, 'blocked', message, { price, quantity, orderAmount });
        await sendTelegramMessage(credentials.telegramBotToken, credentials.telegramChatId, `${buildTelegramMessage(rule, price, evaluation)}\nBlocked: below min buy price.`);
        return;
    }

    if (!rule.cash_guard_agreed) {
        await insertEvent(config, rule, 'blocked', 'Cash guard agreement is missing.', { price, quantity, orderAmount });
        return;
    }

    if (!quantity || quantity <= 0) {
        await insertEvent(config, rule, 'blocked', 'Order quantity is missing.', { price, quantity, orderAmount });
        return;
    }

    const cash = await getOrderableCash(credentials);
    const orderableAmount = normalizeNumber(cash.orderableAmount);
    if (orderAmount > orderableAmount) {
        const message = `Signal matched but order amount ${orderAmount} is above orderable cash ${orderableAmount}.`;
        await insertEvent(config, rule, 'blocked', message, { price, quantity, orderAmount });
        await sendTelegramMessage(credentials.telegramBotToken, credentials.telegramChatId, `${buildTelegramMessage(rule, price, evaluation)}\nBlocked: order amount is above orderable cash.`);
        return;
    }

    if (!rule.auto_order_enabled) {
        await insertEvent(config, rule, 'signal', 'Signal matched. Auto order is disabled.', { price, quantity, orderAmount });
        await sendTelegramMessage(credentials.telegramBotToken, credentials.telegramChatId, buildTelegramMessage(rule, price, evaluation));
        return;
    }

    if (!isRegularMarketTime()) {
        await insertEvent(config, rule, 'signal', 'Signal matched outside regular market time.', { price, quantity, orderAmount });
        await sendTelegramMessage(credentials.telegramBotToken, credentials.telegramChatId, `${buildTelegramMessage(rule, price, evaluation)}\nOrder skipped: outside regular market time.`);
        return;
    }

    const orderResult = await placeStockOrder({
        action: 'buy',
        priceMode: 'limit',
        stockCode: rule.stock_code,
        quantity,
        price: Math.round(price),
        exchange: 'SOR',
    }, credentials);

    await updateRule(config, rule.id, { last_order_at: new Date().toISOString() });
    await insertEvent(config, rule, 'order_submitted', 'Buy order submitted.', {
        price,
        quantity,
        orderAmount,
        rawPayload: orderResult.raw || orderResult,
    });
    await sendTelegramMessage(
        credentials.telegramBotToken,
        credentials.telegramChatId,
        buildTelegramMessage(rule, price, evaluation, orderResult),
    );
}

async function runAutoTradeOnce() {
    if (running) return;
    running = true;
    lastRunAt = new Date().toISOString();

    try {
        const config = getBackendSupabaseConfig();
        const rules = await getEnabledRules(config);
        for (const rule of rules) {
            try {
                await processRule(config, rule);
            } catch (error) {
                await insertEvent(config, rule, 'error', error.message || 'Auto trade rule failed.').catch(() => {});
                console.error('[auto-trade] rule failed:', rule.id, error.message);
            }
        }
        lastError = '';
    } catch (error) {
        lastError = error.message || String(error);
        console.error('[auto-trade] engine failed:', lastError);
    } finally {
        running = false;
    }
}

function startAutoTradeEngine() {
    if (timer) return;
    const pollMs = Math.max(15_000, Number(process.env.AUTO_TRADE_POLL_MS || DEFAULT_POLL_MS));
    timer = setInterval(runAutoTradeOnce, pollMs);
    timer.unref?.();
    runAutoTradeOnce();
    console.log(`[auto-trade] engine started. poll=${pollMs}ms`);
}

function stopAutoTradeEngine() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
}

function getAutoTradeEngineStatus() {
    return {
        running,
        started: Boolean(timer),
        lastRunAt,
        lastError,
    };
}

module.exports = {
    getAutoTradeEngineStatus,
    runAutoTradeOnce,
    startAutoTradeEngine,
    stopAutoTradeEngine,
};
