const {
    getAuthenticatedSupabaseUser,
    getBackendSupabaseConfig,
    requestSupabaseJson,
} = require('./userCredentials');
const { getHomeRanking } = require('./rankings');
const { getStockInfo } = require('./stocks');

const WATCHLIST_ITEM_LIMIT = 20;
const WATCHLIST_QUOTE_DELAY_MS = 500;
const RANKING_SOURCE_TYPES = new Set(['realtime', 'gainers', 'losers', 'volume', 'volumeSpike']);

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(error) {
    return String(error?.message || error || '').includes('429')
        || String(error?.message || error || '').includes('허용된 요청개수');
}

function getQuoteErrorMetric(error) {
    if (isRateLimitError(error)) {
        return '요청 제한';
    }

    return '조회 실패';
}

async function getStockInfoWithRateLimit(stockCode, credentials) {
    try {
        return await getStockInfo(stockCode, credentials);
    } catch (error) {
        if (!isRateLimitError(error)) throw error;
        await delay(1500);
        return getStockInfo(stockCode, credentials);
    }
}

function toRankingQuoteItem(savedItem, rankingItem, index) {
    return {
        rank: index + 1,
        code: rankingItem.code || savedItem.stock_code,
        name: rankingItem.name || savedItem.stock_name,
        price: rankingItem.price,
        change: rankingItem.change,
        changeRate: rankingItem.changeRate,
        volume: rankingItem.volume,
        direction: rankingItem.direction,
        metric: rankingItem.metric,
    };
}

async function getRankingBackedWatchlistQuotes(sortedItems, credentials) {
    const sourceTypes = Array.from(new Set(sortedItems.map((item) => item.source_type || 'manual')));
    if (sourceTypes.length !== 1 || !RANKING_SOURCE_TYPES.has(sourceTypes[0])) return null;

    const ranking = await getHomeRanking(sourceTypes[0], WATCHLIST_ITEM_LIMIT, credentials);
    const rankingItemsByCode = new Map((ranking.items || []).map((item) => [item.code, item]));

    if (!sortedItems.every((item) => rankingItemsByCode.has(item.stock_code))) return null;

    return sortedItems.map((item, index) => toRankingQuoteItem(item, rankingItemsByCode.get(item.stock_code), index));
}

async function getIndividualWatchlistQuotes(sortedItems, credentials) {
    const items = [];

    for (const [index, item] of sortedItems.entries()) {
        if (index > 0) {
            await delay(WATCHLIST_QUOTE_DELAY_MS);
        }

        try {
            const stock = await getStockInfoWithRateLimit(item.stock_code, credentials);
            items.push({
                rank: index + 1,
                code: stock.code || item.stock_code,
                name: stock.name || item.stock_name,
                price: stock.price,
                change: stock.change,
                changeRate: stock.changeRate,
                volume: stock.volume,
                direction: stock.direction,
            });
        } catch (error) {
            items.push({
                rank: index + 1,
                code: item.stock_code,
                name: item.stock_name,
                price: null,
                change: null,
                changeRate: null,
                volume: null,
                direction: 'flat',
                metric: getQuoteErrorMetric(error),
            });
        }
    }

    return items;
}

function getServiceHeaders(config, extra = {}) {
    return {
        apikey: config.serviceKey,
        Authorization: `Bearer ${config.serviceKey}`,
        ...extra,
    };
}

function normalizeName(name) {
    return String(name || '').trim().slice(0, 40);
}

function normalizeStockItem(item, index) {
    return {
        stock_code: String(item?.code || item?.stock_code || '').replace(/^A/i, '').trim().slice(0, 12),
        stock_name: String(item?.name || item?.stock_name || '').trim().slice(0, 80),
        source_type: String(item?.sourceType || item?.source_type || 'manual').trim().slice(0, 40),
        sort_order: Number.isFinite(Number(item?.sortOrder ?? item?.sort_order))
            ? Number(item?.sortOrder ?? item?.sort_order)
            : index,
    };
}

function toGroupDto(group, items = []) {
    return {
        id: group.id,
        name: group.name,
        createdAt: group.created_at,
        updatedAt: group.updated_at,
        items: items
            .slice()
            .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
            .map((item) => ({
                id: item.id,
                code: item.stock_code,
                name: item.stock_name,
                sourceType: item.source_type,
                sortOrder: item.sort_order,
            })),
    };
}

function assertGroupName(name) {
    const normalizedName = normalizeName(name);
    if (!normalizedName) {
        const error = new Error('Group name is required.');
        error.statusCode = 400;
        throw error;
    }

    return normalizedName;
}

function assertItems(items) {
    if (!Array.isArray(items)) return [];

    const seen = new Set();
    return items
        .map(normalizeStockItem)
        .filter((item) => item.stock_code && item.stock_name)
        .filter((item) => {
            if (seen.has(item.stock_code)) return false;
            seen.add(item.stock_code);
            return true;
        })
        .slice(0, WATCHLIST_ITEM_LIMIT)
        .map((item, index) => ({
            ...item,
            sort_order: index,
        }));
}

async function getOwnedGroup(groupId, userId, config) {
    const rows = await requestSupabaseJson(
        `${config.url}/rest/v1/watchlist_groups?id=eq.${encodeURIComponent(groupId)}&user_id=eq.${encodeURIComponent(userId)}&select=id,name,created_at,updated_at&limit=1`,
        { headers: getServiceHeaders(config) },
    );
    const group = Array.isArray(rows) ? rows[0] : null;
    if (!group) {
        const error = new Error('Watchlist group not found.');
        error.statusCode = 404;
        throw error;
    }

    return group;
}

async function getItemsForGroups(groupIds, config) {
    if (!groupIds.length) return [];
    const filter = groupIds.map((id) => encodeURIComponent(id)).join(',');
    return requestSupabaseJson(
        `${config.url}/rest/v1/watchlist_items?group_id=in.(${filter})&select=id,group_id,stock_code,stock_name,source_type,sort_order&order=sort_order.asc`,
        { headers: getServiceHeaders(config) },
    );
}

async function getWatchlists(request, requestUrl) {
    const config = getBackendSupabaseConfig();
    const user = await getAuthenticatedSupabaseUser(request, requestUrl);
    const groups = await requestSupabaseJson(
        `${config.url}/rest/v1/watchlist_groups?user_id=eq.${encodeURIComponent(user.id)}&select=id,name,created_at,updated_at&order=created_at.asc`,
        { headers: getServiceHeaders(config) },
    );
    const items = await getItemsForGroups(groups.map((group) => group.id), config);

    return {
        groups: groups.map((group) => toGroupDto(
            group,
            items.filter((item) => item.group_id === group.id),
        )),
    };
}

async function createWatchlist(request, payload, requestUrl) {
    const config = getBackendSupabaseConfig();
    const user = await getAuthenticatedSupabaseUser(request, requestUrl);
    const name = assertGroupName(payload?.name);

    const rows = await requestSupabaseJson(`${config.url}/rest/v1/watchlist_groups?select=id,name,created_at,updated_at`, {
        method: 'POST',
        headers: getServiceHeaders(config, {
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
        }),
        body: JSON.stringify({
            user_id: user.id,
            name,
        }),
    });

    return { group: toGroupDto(rows[0], []) };
}

async function replaceWatchlistItems(groupId, userId, items, config) {
    await requestSupabaseJson(
        `${config.url}/rest/v1/watchlist_items?group_id=eq.${encodeURIComponent(groupId)}&user_id=eq.${encodeURIComponent(userId)}`,
        {
            method: 'DELETE',
            headers: getServiceHeaders(config),
        },
    );

    if (!items.length) return;

    await requestSupabaseJson(`${config.url}/rest/v1/watchlist_items`, {
        method: 'POST',
        headers: getServiceHeaders(config, {
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
        }),
        body: JSON.stringify(items.map((item) => ({
            group_id: groupId,
            user_id: userId,
            ...item,
        }))),
    });
}

async function updateWatchlist(request, groupId, payload, requestUrl) {
    const config = getBackendSupabaseConfig();
    const user = await getAuthenticatedSupabaseUser(request, requestUrl);
    await getOwnedGroup(groupId, user.id, config);

    const name = assertGroupName(payload?.name);
    const rows = await requestSupabaseJson(
        `${config.url}/rest/v1/watchlist_groups?id=eq.${encodeURIComponent(groupId)}&user_id=eq.${encodeURIComponent(user.id)}&select=id,name,created_at,updated_at`,
        {
            method: 'PATCH',
            headers: getServiceHeaders(config, {
                'Content-Type': 'application/json',
                Prefer: 'return=representation',
            }),
            body: JSON.stringify({
                name,
                updated_at: new Date().toISOString(),
            }),
        },
    );

    const items = assertItems(payload?.items);
    await replaceWatchlistItems(groupId, user.id, items, config);
    const savedItems = await getItemsForGroups([groupId], config);

    return { group: toGroupDto(rows[0], savedItems) };
}

async function deleteWatchlist(request, groupId, requestUrl) {
    const config = getBackendSupabaseConfig();
    const user = await getAuthenticatedSupabaseUser(request, requestUrl);
    await getOwnedGroup(groupId, user.id, config);

    await requestSupabaseJson(
        `${config.url}/rest/v1/watchlist_groups?id=eq.${encodeURIComponent(groupId)}&user_id=eq.${encodeURIComponent(user.id)}`,
        {
            method: 'DELETE',
            headers: getServiceHeaders(config),
        },
    );

    return { ok: true };
}

async function getWatchlistQuotes(request, groupId, requestUrl, credentials) {
    const config = getBackendSupabaseConfig();
    const user = await getAuthenticatedSupabaseUser(request, requestUrl);
    const group = await getOwnedGroup(groupId, user.id, config);
    const savedItems = await getItemsForGroups([groupId], config);
    const sortedItems = savedItems
        .filter((item) => item.group_id === groupId)
        .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));

    const items = await getRankingBackedWatchlistQuotes(sortedItems, credentials)
        || await getIndividualWatchlistQuotes(sortedItems, credentials);

    return {
        group: toGroupDto(group, sortedItems),
        items,
    };
}

module.exports = {
    createWatchlist,
    deleteWatchlist,
    getWatchlistQuotes,
    getWatchlists,
    updateWatchlist,
};
