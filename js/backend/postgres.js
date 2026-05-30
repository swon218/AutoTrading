// Local PostgreSQL connection draft for historical chart storage.
// Install later with: npm install pg
// .env example:
// POSTGRES_URL=postgres://postgres:password@localhost:5432/autotrading

const { loadDotEnv } = require('./env');

loadDotEnv();

let pool = null;

function getPgPool() {
    if (pool) return pool;

    let Pool;
    try {
        ({ Pool } = require('pg'));
    } catch {
        throw new Error('PostgreSQL driver is not installed. Run: npm install pg');
    }

    const connectionString = process.env.POSTGRES_URL;
    if (!connectionString) {
        throw new Error('POSTGRES_URL is missing. Add it to .env before using local PostgreSQL.');
    }

    pool = new Pool({
        connectionString,
        max: Number(process.env.POSTGRES_POOL_MAX || 10),
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
    });

    return pool;
}

async function query(text, params = []) {
    return getPgPool().query(text, params);
}

async function upsertCandles15m(stockCode, candles = []) {
    if (!candles.length) return { rowCount: 0 };

    const values = [];
    const placeholders = candles.map((candle, index) => {
        const offset = index * 7;
        values.push(
            stockCode,
            candle.time,
            candle.open,
            candle.high,
            candle.low,
            candle.close,
            candle.volume || 0,
        );
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`;
    });

    return query(
        `
        INSERT INTO market_data.stock_candles_15m (
            stock_code,
            candle_time,
            open_price,
            high_price,
            low_price,
            close_price,
            volume
        )
        VALUES ${placeholders.join(', ')}
        ON CONFLICT (stock_code, candle_time)
        DO UPDATE SET
            open_price = EXCLUDED.open_price,
            high_price = EXCLUDED.high_price,
            low_price = EXCLUDED.low_price,
            close_price = EXCLUDED.close_price,
            volume = EXCLUDED.volume
        `,
        values,
    );
}

async function getCandles15m(stockCode, startDate = null, endDate = null, limit = 0) {
    const params = [stockCode];
    const conditions = ['stock_code = $1'];

    if (startDate) {
        params.push(startDate);
        conditions.push(`candle_time >= $${params.length}::timestamptz`);
    }
    if (endDate) {
        params.push(endDate);
        conditions.push(`candle_time <= $${params.length}::timestamptz`);
    }
    if (Number(limit) > 0) {
        params.push(Math.floor(Number(limit)));
    }

    const limitClause = Number(limit) > 0 ? `LIMIT $${params.length}` : '';
    const result = await query(
        `
        SELECT *
        FROM (
            SELECT
                stock_code,
                candle_time,
                open_price,
                high_price,
                low_price,
                close_price,
                volume
            FROM market_data.stock_candles_15m
            WHERE ${conditions.join(' AND ')}
            ORDER BY candle_time DESC
            ${limitClause}
        ) candles
        ORDER BY candle_time ASC
        `,
        params,
    );

    return result.rows;
}

function toKoreaTimeString(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';

    const koreaTime = new Date(date.getTime() + 9 * 60 * 60 * 1000);
    return koreaTime.toISOString().replace('Z', '+09:00');
}

function rowToCandle(row) {
    return {
        time: toKoreaTimeString(row.candle_time),
        open: Number(row.open_price),
        high: Number(row.high_price),
        low: Number(row.low_price),
        close: Number(row.close_price),
        volume: Number(row.volume || 0),
    };
}

async function closePgPool() {
    if (!pool) return;
    await pool.end();
    pool = null;
}

module.exports = {
    closePgPool,
    getCandles15m,
    getPgPool,
    query,
    rowToCandle,
    upsertCandles15m,
};
