//차트 데이터

const { requestKiwoomTr } = require('./kiwoomAuth');
const { resolveStockCode } = require('./stocks');
const {
    absoluteNumber,
    kiwoomDateToTime,
    todayYmd,
} = require('./kiwoomUtils');

const chartCache = new Map();
const CHART_CANDLE_LIMIT = 1000;
const DAILY_CHART_INTERVALS = new Set(['day', 'week', 'month']);
const CHART_API_BY_INTERVAL = {
    day: 'ka10081',
    week: 'ka10082',
    month: 'ka10083',
};

function formatYmd(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
}

function getSettledBaseDate() {
    const date = new Date();
    const koreaNow = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const minutes = koreaNow.getHours() * 60 + koreaNow.getMinutes();

    if (koreaNow.getDay() === 0) {
        koreaNow.setDate(koreaNow.getDate() - 2);
    } else if (koreaNow.getDay() === 6) {
        koreaNow.setDate(koreaNow.getDate() - 1);
    } else if (minutes < 16 * 60) {
        koreaNow.setDate(koreaNow.getDate() - 1);
        if (koreaNow.getDay() === 0) {
            koreaNow.setDate(koreaNow.getDate() - 2);
        } else if (koreaNow.getDay() === 6) {
            koreaNow.setDate(koreaNow.getDate() - 1);
        }
    }

    return formatYmd(koreaNow);
}

function filterCandlesByYears(candles, years) {
    const yearsNumber = Number(years);
    if (!Number.isFinite(yearsNumber) || yearsNumber <= 0) return candles;

    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - yearsNumber);
    const cutoffDate = cutoff.toISOString().slice(0, 10);
    return candles.filter((candle) => String(candle.time || '').slice(0, 10) >= cutoffDate);
}

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

function getIntradayBucketTime(time, intervalMinutes) {
    const match = String(time || '').match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
    if (!match) return time;

    const [, datePart, hourText, minuteText] = match;
    const minutes = Number(hourText) * 60 + Number(minuteText);
    const marketOpenMinutes = 9 * 60;
    const elapsedMinutes = Math.max(0, minutes - marketOpenMinutes);
    const bucketStartMinutes = marketOpenMinutes + Math.floor(elapsedMinutes / intervalMinutes) * intervalMinutes;
    const bucketHour = String(Math.floor(bucketStartMinutes / 60)).padStart(2, '0');
    const bucketMinute = String(bucketStartMinutes % 60).padStart(2, '0');

    return `${datePart}T${bucketHour}:${bucketMinute}:00+09:00`;
}

function aggregateIntradayCandles(candles, intervalMinutes) {
    const buckets = new Map();

    for (const candle of candles) {
        const bucketTime = getIntradayBucketTime(candle.time, intervalMinutes);
        const bucket = buckets.get(bucketTime);

        if (!bucket) {
            buckets.set(bucketTime, {
                time: bucketTime,
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close,
                volume: candle.volume || 0,
            });
            continue;
        }

        bucket.high = Math.max(bucket.high, candle.high);
        bucket.low = Math.min(bucket.low, candle.low);
        bucket.close = candle.close;
        bucket.volume += candle.volume || 0;
    }

    return Array.from(buckets.values());
}

async function getChartData(query, interval = '1', credentials = null, options = {}) {
    const code = await resolveStockCode(query, credentials);
    const normalizedInterval = ['1', '5', '15', '30', '60', '120', 'day', 'week', 'month'].includes(interval) ? interval : '1';
    const requestInterval = normalizedInterval === '120' ? '60' : normalizedInterval;
    const aggregateMinutes = normalizedInterval === '120' ? Number(normalizedInterval) : null;
    const years = Number(options.years) || 0;
    const settled = Boolean(options.settled);
    const baseDate = settled && DAILY_CHART_INTERVALS.has(requestInterval) ? getSettledBaseDate() : todayYmd();
    const cacheKey = `${code}:${normalizedInterval}:years=${years}:settled=${settled ? '1' : '0'}:base=${baseDate}`;
    const cached = chartCache.get(cacheKey);
    const now = Date.now();

    if (cached && cached.expiresAt > now) {
        return cached.data;
    }

    const apiId = CHART_API_BY_INTERVAL[requestInterval] || 'ka10080';
    const body = DAILY_CHART_INTERVALS.has(requestInterval)
        ? { stk_cd: code, base_dt: baseDate, upd_stkpc_tp: '1' }
        : { stk_cd: code, tic_scope: requestInterval, upd_stkpc_tp: '1' };

    const payload = await requestKiwoomTr(apiId, body, '/api/dostk/chart', credentials);

    if (payload.return_code !== 0) {
        throw new Error(payload.return_msg || `Chart request failed: ${JSON.stringify(payload)}`);
    }

    const chartItems = getChartItems(payload, requestInterval);
    const rawCandles = chartItems
        .map((item) => toCandle(item, requestInterval))
        .filter((candle) => {
            return candle.time && candle.open !== null && candle.high !== null
                && candle.low !== null && candle.close !== null;
        })
        .reverse();

    const aggregatedCandles = filterCandlesByYears(
        aggregateMinutes ? aggregateIntradayCandles(rawCandles, aggregateMinutes) : rawCandles,
        years,
    );
    const candles = aggregatedCandles.slice(-CHART_CANDLE_LIMIT);

    const data = {
        code,
        interval: normalizedInterval,
        candles,
    };

    if (candles.length) {
        chartCache.set(cacheKey, {
            data,
            expiresAt: now + 30 * 1000,
        });
    } else {
        chartCache.delete(cacheKey);
    }

    return data;
}

module.exports = {
    getChartData,
};
