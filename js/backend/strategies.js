const {
    getAuthenticatedSupabaseUser,
    getBackendSupabaseConfig,
    requestSupabaseJson,
} = require('./userCredentials');

function strategyRowToDto(row) {
    return {
        id: String(row.id),
        name: row.name,
        indicators: Array.isArray(row.config_json?.indicators)
            ? row.config_json.indicators
            : Array.isArray(row.config_json) ? row.config_json : [],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function normalizeStrategyName(name) {
    return String(name || '').replace(/\s+/g, '').toLowerCase();
}

function dedupeIndicatorsByKey(indicators = []) {
    const seenKeys = new Set();
    return indicators.filter((indicator) => {
        if (!indicator?.key || seenKeys.has(indicator.key)) return false;
        seenKeys.add(indicator.key);
        return true;
    });
}

function validateStrategyPayload(payload) {
    const name = String(payload.name || '').trim();
    const indicators = dedupeIndicatorsByKey(Array.isArray(payload.indicators) ? payload.indicators : []);

    if (!name) throw new Error('Strategy name is required.');
    if (!indicators.length) throw new Error('At least one indicator is required.');

    return { name, indicators };
}

function getStrategyHeaders(config) {
    return {
        apikey: config.serviceKey,
        Authorization: `Bearer ${config.serviceKey}`,
        'Content-Type': 'application/json',
    };
}

async function getUserStrategyRows(userId, config) {
    return requestSupabaseJson(
        `${config.url}/rest/v1/strategies?user_id=eq.${encodeURIComponent(userId)}&select=id,name,config_json,created_at,updated_at&order=created_at.asc`,
        {
            headers: getStrategyHeaders(config),
        },
    );
}

async function ensureUniqueStrategyName(userId, name, config, excludeId = '') {
    const rows = await getUserStrategyRows(userId, config);
    const duplicate = rows.find((strategy) => {
        return String(strategy.id) !== String(excludeId)
            && normalizeStrategyName(strategy.name) === normalizeStrategyName(name);
    });

    if (duplicate) throw new Error('Strategy name already exists.');
}

async function getIndicatorStrategies(request, requestUrl = null) {
    const config = getBackendSupabaseConfig();
    const user = await getAuthenticatedSupabaseUser(request, requestUrl);
    const rows = await getUserStrategyRows(user.id, config);
    return rows.map(strategyRowToDto);
}

async function createIndicatorStrategy(request, payload, requestUrl = null) {
    const config = getBackendSupabaseConfig();
    const user = await getAuthenticatedSupabaseUser(request, requestUrl);
    const { name, indicators } = validateStrategyPayload(payload);

    await ensureUniqueStrategyName(user.id, name, config);

    const rows = await requestSupabaseJson(`${config.url}/rest/v1/strategies?select=id,name,config_json,created_at,updated_at`, {
        method: 'POST',
        headers: {
            ...getStrategyHeaders(config),
            Prefer: 'return=representation',
        },
        body: JSON.stringify({
            user_id: user.id,
            name,
            config_json: { indicators },
            is_active: true,
        }),
    });

    return strategyRowToDto(rows[0]);
}

async function updateIndicatorStrategy(request, id, payload, requestUrl = null) {
    const config = getBackendSupabaseConfig();
    const user = await getAuthenticatedSupabaseUser(request, requestUrl);
    const { name, indicators } = validateStrategyPayload(payload);

    await ensureUniqueStrategyName(user.id, name, config, id);

    const rows = await requestSupabaseJson(
        `${config.url}/rest/v1/strategies?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(user.id)}&select=id,name,config_json,created_at,updated_at`,
        {
            method: 'PATCH',
            headers: {
                ...getStrategyHeaders(config),
                Prefer: 'return=representation',
            },
            body: JSON.stringify({
                name,
                config_json: { indicators },
                updated_at: new Date().toISOString(),
            }),
        },
    );

    if (!rows.length) throw new Error('Strategy not found.');
    return strategyRowToDto(rows[0]);
}

async function deleteIndicatorStrategy(request, id, requestUrl = null) {
    const config = getBackendSupabaseConfig();
    const user = await getAuthenticatedSupabaseUser(request, requestUrl);
    const rows = await requestSupabaseJson(
        `${config.url}/rest/v1/strategies?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(user.id)}&select=id`,
        {
            method: 'DELETE',
            headers: {
                ...getStrategyHeaders(config),
                Prefer: 'return=representation',
            },
        },
    );

    if (!rows.length) throw new Error('Strategy not found.');
}

module.exports = {
    createIndicatorStrategy,
    deleteIndicatorStrategy,
    getIndicatorStrategies,
    updateIndicatorStrategy,
};
