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

async function getCandles15m(stockCode, startDate, endDate) {
    const result = await query(
        `
        SELECT
            stock_code,
            candle_time,
            open_price,
            high_price,
            low_price,
            close_price,
            volume
        FROM market_data.stock_candles_15m
        WHERE stock_code = $1
          AND candle_time >= $2::timestamptz
          AND candle_time <= $3::timestamptz
        ORDER BY candle_time ASC
        `,
        [stockCode, startDate, endDate],
    );

    return result.rows;
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
    upsertCandles15m,
};
