//종목 검색, 현재가/고가/저가/거래량

const { requestKiwoomTr } = require('./kiwoomAuth');
const { absoluteNumber, signedNumber } = require('./kiwoomUtils');

let stockListCache = {
    items: [],
    expiresAt: 0,
};

function toStockDto(payload, code) {
    const change = signedNumber(payload.pred_pre);
    const changeRate = signedNumber(payload.flu_rt);
    const price = absoluteNumber(payload.cur_prc);
    let high = absoluteNumber(payload.high_pric);
    let low = absoluteNumber(payload.low_pric);
    let volume = absoluteNumber(payload.trde_qty);

    if (volume === 0 && high === price && low === price) {
        high = null;
        low = null;
        volume = null;
    }

    return {
        name: payload.stk_nm || '',
        code: payload.stk_cd || code,
        price,
        change,
        changeRate,
        high,
        low,
        volume,
        direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
        raw: {
            return_code: payload.return_code,
            return_msg: payload.return_msg,
        },
    };
}

async function getStockInfo(code, credentials = null) {
    const payload = await requestKiwoomTr('ka10001', { stk_cd: code }, '/api/dostk/stkinfo', credentials);

    if (payload.return_code !== 0) {
        throw new Error(payload.return_msg || `종목 조회 실패: ${JSON.stringify(payload)}`);
    }

    return toStockDto(payload, code);
}

function normalizeStockItem(item) {
    const rawCode = String(item.stk_cd || item.code || '').trim();
    const code = rawCode.replace(/^A/i, '');
    const name = String(item.stk_nm || item.name || '').trim();

    if (!code || !name) return null;
    return { code, name };
}

async function getStockList(credentials = null) {
    const now = Date.now();
    if (stockListCache.items.length && stockListCache.expiresAt > now) {
        return stockListCache.items;
    }

    const marketTypes = ['0', '10', '8'];
    const stocks = [];

    for (const mrktTp of marketTypes) {
        try {
            const payload = await requestKiwoomTr('ka10099', { mrkt_tp: mrktTp }, '/api/dostk/stkinfo', credentials);
            const list = Array.isArray(payload.list) ? payload.list : [];

            for (const item of list) {
                const stock = normalizeStockItem(item);
                if (stock) stocks.push(stock);
            }
        } catch (error) {
            console.warn(`Stock list request failed(mrkt_tp=${mrktTp}):`, error.message);
        }
    }

    const uniqueStocks = Array.from(
        new Map(stocks.map((stock) => [stock.code, stock])).values(),
    );

    if (!uniqueStocks.length) {
        throw new Error('Stock list is empty.');
    }

    stockListCache = {
        items: uniqueStocks,
        expiresAt: now + 24 * 60 * 60 * 1000,
    };

    return uniqueStocks;
}

async function searchStocks(query, limit = 10, credentials = null) {
    const keyword = String(query || '').trim();
    if (!keyword) return [];

    const normalizedKeyword = keyword.toLowerCase();
    const stocks = await getStockList(credentials);

    return stocks
        .filter((stock) => stock.code.includes(keyword) || stock.name.toLowerCase().includes(normalizedKeyword))
        .sort((a, b) => {
            const aExact = a.code === keyword || a.name === keyword;
            const bExact = b.code === keyword || b.name === keyword;
            if (aExact !== bExact) return aExact ? -1 : 1;

            const aStarts = a.code.startsWith(keyword) || a.name.startsWith(keyword);
            const bStarts = b.code.startsWith(keyword) || b.name.startsWith(keyword);
            if (aStarts !== bStarts) return aStarts ? -1 : 1;

            return a.name.localeCompare(b.name, 'ko-KR');
        })
        .slice(0, limit);
}

async function resolveStockCode(query, credentials = null) {
    const keyword = String(query || '').trim();
    if (/^\d{6}$/.test(keyword)) {
        return keyword;
    }

    const results = await searchStocks(keyword, 1, credentials);
    if (!results.length) {
        throw new Error(`No stock found: ${keyword}`);
    }

    return results[0].code;
}

module.exports = {
    getStockInfo,
    resolveStockCode,
    searchStocks,
};
