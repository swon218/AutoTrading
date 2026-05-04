//차트 데이터

const { requestKiwoomTr } = require('./kiwoomAuth');
const { resolveStockCode } = require('./stocks');
const {
    absoluteNumber,
    kiwoomDateToTime,
    todayYmd,
} = require('./kiwoomUtils');

const chartCache = new Map();
const DAILY_CHART_INTERVALS = new Set(['day', 'week', 'month']);
const CHART_API_BY_INTERVAL = {
    day: 'ka10081',
    week: 'ka10082',
    month: 'ka10083',
};

function toCandle(item, interval) {
    const timeSource = DAILY_CHART_INTERVALS.has(interval) ? item.dt : item.cntr_tm;
    return {
        time: kiwoomDateToTime(timeSource),
        open: absoluteNumber(item.open_pric),
        high: absoluteNumber(item.high_pric),
        low: absoluteNumber(item.low_pric),
        close: absoluteNumber(item.cur_prc),
        volume: absoluteNumber(item.trde_qty),
    };
}

function getChartItems(payload, interval) {
    if (interval === 'day') return payload.stk_dt_pole_chart_qry || payload.list || [];
    if (interval === 'week') {
        return payload.stk_stk_pole_chart_qry || payload.stk_wk_pole_chart_qry || payload.list || [];
    }
    if (interval === 'month') {
        return payload.stk_mth_pole_chart_qry || payload.list || [];
    }

    return payload.stk_min_pole_chart_qry || payload.list || [];
}

function aggregateCandles(candles, groupSize) {
    const aggregated = [];
    let group = [];

    const flushGroup = () => {
        if (!group.length) return;
        aggregated.push({
            time: group[0].time,
            open: group[0].open,
            high: Math.max(...group.map((candle) => candle.high)),
            low: Math.min(...group.map((candle) => candle.low)),
            close: group[group.length - 1].close,
            volume: group.reduce((sum, candle) => sum + (candle.volume || 0), 0),
        });
        group = [];
    };

    for (const candle of candles) {
        if (group.length && group[0].time.slice(0, 10) !== candle.time.slice(0, 10)) {
            flushGroup();
        }

        group.push(candle);

        if (group.length === groupSize) {
            flushGroup();
        }
    }

    flushGroup();

    return aggregated;
}

async function getChartData(query, interval = '1') {
    const code = await resolveStockCode(query);
    const normalizedInterval = ['1', '5', '15', '60', '120', 'day', 'week', 'month'].includes(interval) ? interval : '1';
    const requestInterval = normalizedInterval === '120' ? '60' : normalizedInterval;
    const cacheKey = `${code}:${normalizedInterval}`;
    const cached = chartCache.get(cacheKey);
    const now = Date.now();

    if (cached && cached.expiresAt > now) {
        return cached.data;
    }

    const apiId = CHART_API_BY_INTERVAL[requestInterval] || 'ka10080';
    const body = DAILY_CHART_INTERVALS.has(requestInterval)
        ? { stk_cd: code, base_dt: todayYmd(), upd_stkpc_tp: '1' }
        : { stk_cd: code, tic_scope: requestInterval, upd_stkpc_tp: '1' };

    const payload = await requestKiwoomTr(apiId, body, '/api/dostk/chart');

    if (payload.return_code !== 0) {
        throw new Error(payload.return_msg || `Chart request failed: ${JSON.stringify(payload)}`);
    }

    const rawCandles = getChartItems(payload, requestInterval)
        .map((item) => toCandle(item, requestInterval))
        .filter((candle) => {
            return candle.time && candle.open !== null && candle.high !== null
                && candle.low !== null && candle.close !== null;
        })
        .reverse();

    const candles = (normalizedInterval === '120' ? aggregateCandles(rawCandles, 2) : rawCandles)
        .slice(-180);

    const data = {
        code,
        interval: normalizedInterval,
        candles,
    };

    chartCache.set(cacheKey, {
        data,
        expiresAt: now + 30 * 1000,
    });

    return data;
}

module.exports = {
    getChartData,
};
