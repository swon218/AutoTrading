const {
    getAuthenticatedSupabaseUser,
    getBackendSupabaseConfig,
    getUserIntegrationStatus,
    requestSupabaseJson,
} = require('./userCredentials');

function getHeaders(config) {
    return {
        apikey: config.serviceKey,
        Authorization: `Bearer ${config.serviceKey}`,
        'Content-Type': 'application/json',
    };
}

function ruleRowToDto(row) {
    return {
        id: String(row.id),
        stockCode: row.stock_code,
        stockName: row.stock_name || '',
        strategyId: row.strategy_id,
        strategyName: row.strategies?.name || '',
        isEnabled: Boolean(row.is_enabled),
        maxBuyPrice: row.max_buy_price === null ? null : Number(row.max_buy_price),
        minBuyPrice: row.min_buy_price === null ? null : Number(row.min_buy_price),
        orderQuantity: row.order_quantity === null ? null : Number(row.order_quantity),
        orderAmount: row.order_amount === null ? null : Number(row.order_amount),
        cashGuardAgreed: Boolean(row.cash_guard_agreed),
        telegramAlertEnabled: Boolean(row.telegram_alert_enabled),
        autoOrderEnabled: Boolean(row.auto_order_enabled),
        lastSignalAt: row.last_signal_at,
        lastOrderAt: row.last_order_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function numberOrNull(value) {
    if (value === undefined || value === null || value === '') return null;
    const number = Number(String(value).replace(/,/g, ''));
    return Number.isFinite(number) && number > 0 ? number : null;
}

function validateRulePayload(payload) {
    const stockCode = String(payload.stockCode || '').trim().replace(/^A/i, '');
    const stockName = String(payload.stockName || '').trim();
    const strategyId = String(payload.strategyId || '').trim();
    const maxBuyPrice = numberOrNull(payload.maxBuyPrice);
    const minBuyPrice = numberOrNull(payload.minBuyPrice);
    const orderQuantity = numberOrNull(payload.orderQuantity);
    const orderAmount = numberOrNull(payload.orderAmount);
    const priceRangeAgreed = Boolean(payload.priceRangeAgreed);
    const cashGuardAgreed = Boolean(payload.cashGuardAgreed);
    const signalGuardAgreed = Boolean(payload.signalGuardAgreed);

    if (!/^[A-Za-z0-9_]+$/.test(stockCode)) {
        const error = new Error('자동매매할 종목을 먼저 선택하세요.');
        error.statusCode = 400;
        throw error;
    }
    if (!strategyId) {
        const error = new Error('자동매매에 사용할 전략을 선택하세요.');
        error.statusCode = 400;
        throw error;
    }
    if (!orderQuantity && !orderAmount) {
        const error = new Error('주문 수량 또는 주문 금액을 입력하세요.');
        error.statusCode = 400;
        throw error;
    }
    if (!priceRangeAgreed) {
        const error = new Error('매수 상한가/하한가 입력 조건에 동의해야 합니다.');
        error.statusCode = 400;
        throw error;
    }
    if (!cashGuardAgreed) {
        const error = new Error('주문가능금액 초과 시 자동매매하지 않는 조건에 동의해야 합니다.');
        error.statusCode = 400;
        throw error;
    }
    if (!signalGuardAgreed) {
        const error = new Error('주문가능금액/가격범위/전략도달 조건에 동의해야 합니다.');
        error.statusCode = 400;
        throw error;
    }
    if (maxBuyPrice && minBuyPrice && minBuyPrice > maxBuyPrice) {
        const error = new Error('매수 하한가는 매수 상한가보다 클 수 없습니다.');
        error.statusCode = 400;
        throw error;
    }

    return {
        stockCode,
        stockName,
        strategyId,
        maxBuyPrice,
        minBuyPrice,
        orderQuantity: orderQuantity ? Math.floor(orderQuantity) : null,
        orderAmount: orderAmount ? Math.floor(orderAmount) : null,
        cashGuardAgreed,
        telegramAlertEnabled: payload.telegramAlertEnabled !== false,
        autoOrderEnabled: Boolean(payload.autoOrderEnabled),
        isEnabled: Boolean(payload.isEnabled),
    };
}

async function getAutoTradeRules(request, requestUrl = null) {
    const config = getBackendSupabaseConfig();
    const user = await getAuthenticatedSupabaseUser(request, requestUrl);
    const rows = await requestSupabaseJson(
        `${config.url}/rest/v1/auto_trade_rules?user_id=eq.${encodeURIComponent(user.id)}&select=*,strategies(name)&order=created_at.desc`,
        { headers: getHeaders(config) },
    );
    return rows.map(ruleRowToDto);
}

async function saveAutoTradeRule(request, payload, requestUrl = null) {
    const config = getBackendSupabaseConfig();
    const user = await getAuthenticatedSupabaseUser(request, requestUrl);
    const integrations = await getUserIntegrationStatus(request, requestUrl);
    const rule = validateRulePayload(payload);

    if (!integrations.telegramConfigured) {
        const error = new Error('텔레그램 봇 토큰과 Chat ID를 먼저 저장해야 자동매매를 사용할 수 있습니다.');
        error.statusCode = 403;
        throw error;
    }
    if (!integrations.telegramVerified) {
        const error = new Error('텔레그램 인증을 완료해야 자동매매를 사용할 수 있습니다.');
        error.statusCode = 403;
        throw error;
    }
    if (!integrations.kiwoomConfigured) {
        const error = new Error('키움 API 키를 먼저 저장해야 자동매매를 사용할 수 있습니다.');
        error.statusCode = 403;
        throw error;
    }

    const row = {
        user_id: user.id,
        stock_code: rule.stockCode,
        stock_name: rule.stockName,
        strategy_id: rule.strategyId,
        is_enabled: rule.isEnabled,
        max_buy_price: rule.maxBuyPrice,
        min_buy_price: rule.minBuyPrice,
        order_quantity: rule.orderQuantity,
        order_amount: rule.orderAmount,
        cash_guard_agreed: rule.cashGuardAgreed,
        telegram_alert_enabled: rule.telegramAlertEnabled,
        auto_order_enabled: rule.autoOrderEnabled,
        updated_at: new Date().toISOString(),
    };

    const rows = await requestSupabaseJson(
        `${config.url}/rest/v1/auto_trade_rules?on_conflict=user_id,stock_code,strategy_id&select=*,strategies(name)`,
        {
            method: 'POST',
            headers: {
                ...getHeaders(config),
                Prefer: 'resolution=merge-duplicates,return=representation',
            },
            body: JSON.stringify(row),
        },
    );

    return ruleRowToDto(rows[0]);
}

async function updateAutoTradeRuleEnabled(request, id, enabled, requestUrl = null) {
    const config = getBackendSupabaseConfig();
    const user = await getAuthenticatedSupabaseUser(request, requestUrl);
    const rows = await requestSupabaseJson(
        `${config.url}/rest/v1/auto_trade_rules?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(user.id)}&select=*,strategies(name)`,
        {
            method: 'PATCH',
            headers: {
                ...getHeaders(config),
                Prefer: 'return=representation',
            },
            body: JSON.stringify({
                is_enabled: Boolean(enabled),
                updated_at: new Date().toISOString(),
            }),
        },
    );

    if (!rows.length) {
        const error = new Error('자동매매 설정을 찾지 못했습니다.');
        error.statusCode = 404;
        throw error;
    }

    return ruleRowToDto(rows[0]);
}

module.exports = {
    getAutoTradeRules,
    saveAutoTradeRule,
    updateAutoTradeRuleEnabled,
};
