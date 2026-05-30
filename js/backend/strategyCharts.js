const { getCandles15m, rowToCandle } = require('./postgres');
const { resolveStockCode } = require('./stocks');

const SUPPORTED_INTERVALS = new Set(['15', '30', '60', '120']);

function normalizeDate(value) {
    const text = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    if (/^\d{8}$/.test(text)) {
        return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
    }
    return '';
}

function getDefaultStartDate(years) {
    const date = new Date();
    date.setFullYear(date.getFullYear() - years);
    return date.toISOString().slice(0, 10);
}

function getBucketTime(time, intervalMinutes) {
    const match = String(time || '').match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
    if (!match) return time;

    const [, datePart, hourText, minuteText] = match;
    const koreaMinutes = Number(hourText) * 60 + Number(minuteText);
    const marketOpenMinutes = 9 * 60;
    const elapsed = Math.max(0, koreaMinutes - marketOpenMinutes);
    const bucketKoreaMinutes = marketOpenMinutes + Math.floor(elapsed / intervalMinutes) * intervalMinutes;
    const bucketHour = String(Math.floor(bucketKoreaMinutes / 60)).padStart(2, '0');
    const bucketMinute = String(bucketKoreaMinutes % 60).padStart(2, '0');
    return `${datePart}T${bucketHour}:${bucketMinute}:00+09:00`;
}

function aggregateCandles(candles, intervalMinutes) {
    if (intervalMinutes === 15) return candles;

    const buckets = new Map();
    for (const candle of candles) {
        const bucketTime = getBucketTime(candle.time, intervalMinutes);
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

async function getStrategyChartData(query, interval = '15', credentials = null, options = {}) {
    const code = await resolveStockCode(query, credentials);
    const normalizedInterval = SUPPORTED_INTERVALS.has(String(interval)) ? String(interval) : '15';
    const intervalMinutes = Number(normalizedInterval);
    const years = Number(options.years) > 0 ? Number(options.years) : 5;
    const startDate = normalizeDate(options.startDate) || getDefaultStartDate(years);
    const endDate = normalizeDate(options.endDate);
    const limit = Number(options.limit) || 0;

    const rows = await getCandles15m(
        code,
        `${startDate}T00:00:00+09:00`,
        endDate ? `${endDate}T23:59:59+09:00` : null,
        intervalMinutes === 15 ? limit : 0,
    );
    let candles = aggregateCandles(rows.map(rowToCandle), intervalMinutes);

    if (limit > 0 && intervalMinutes !== 15) {
        candles = candles.slice(-limit);
    }

    return {
        code,
        interval: normalizedInterval,
        source: 'postgres',
        candles,
    };
}

module.exports = {
    getStrategyChartData,
};
