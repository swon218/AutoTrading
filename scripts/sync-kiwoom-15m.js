#!/usr/bin/env node

const { requestKiwoomTrWithHeaders } = require('../js/backend/kiwoomAuth');
const { absoluteNumber, kiwoomDateToTime } = require('../js/backend/kiwoomUtils');
const { getStockList } = require('../js/backend/stocks');
const { closePgPool, query, upsertCandles15m } = require('../js/backend/postgres');

const CHART_ENDPOINT = '/api/dostk/chart';
const CHART_API_ID = 'ka10080';
const TIC_SCOPE = '15';
const DEFAULT_SLEEP_MS = 350;
const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_YEARS = 5;

function parseArgs(argv) {
    const options = {
        years: DEFAULT_YEARS,
        sleepMs: DEFAULT_SLEEP_MS,
        batchSize: DEFAULT_BATCH_SIZE,
        codes: [],
        limitStocks: 0,
        maxPagesPerStock: 0,
        startFrom: '',
    };
    const positional = [];

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        const next = argv[index + 1];

        if (arg === '--years') {
            options.years = Number(next || DEFAULT_YEARS);
            index += 1;
        } else if (arg === '--sleep-ms') {
            options.sleepMs = Number(next || DEFAULT_SLEEP_MS);
            index += 1;
        } else if (arg === '--batch-size') {
            options.batchSize = Number(next || DEFAULT_BATCH_SIZE);
            index += 1;
        } else if (arg === '--codes') {
            options.codes = String(next || '')
                .split(',')
                .map((code) => code.trim().replace(/^A/i, ''))
                .filter(Boolean);
            index += 1;
        } else if (arg === '--limit-stocks') {
            options.limitStocks = Number(next || 0);
            index += 1;
        } else if (arg === '--max-pages-per-stock') {
            options.maxPagesPerStock = Number(next || 0);
            index += 1;
        } else if (arg === '--start-from') {
            options.startFrom = String(next || '').trim().replace(/^A/i, '');
            index += 1;
        } else if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else if (!arg.startsWith('-')) {
            positional.push(arg);
        }
    }

    if (!options.codes.length && positional[0]) {
        options.codes = String(positional[0])
            .split(',')
            .map((code) => code.trim().replace(/^A/i, ''))
            .filter(Boolean);
    }
    if (!options.maxPagesPerStock && positional[1]) {
        options.maxPagesPerStock = Number(positional[1] || 0);
    }

    return options;
}

function printHelp() {
    console.log(`
Usage:
  node scripts/sync-kiwoom-15m.js [options]

Options:
  --years 5                  How far back to collect 15m candles.
  --codes 005930,000660      Collect only these stock codes.
  --start-from 005930        Resume all-stock collection from this code.
  --limit-stocks 10          Limit number of stocks for a dry run.
  --max-pages-per-stock 3    Limit continuation pages per stock for testing.
  --sleep-ms 350             Delay between Kiwoom requests.
  --batch-size 500           PostgreSQL upsert batch size.
`);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getCutoffDate(years) {
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - years);
    return cutoff;
}

function getChartItems(payload) {
    return payload.stk_min_pole_chart_qry || payload.list || [];
}

function normalizeCandle(item) {
    const open = absoluteNumber(item.open_pric);
    const high = absoluteNumber(item.high_pric);
    const low = absoluteNumber(item.low_pric);
    const close = absoluteNumber(item.cur_prc);
    const time = kiwoomDateToTime(item.cntr_tm);

    if (!time || open === null || high === null || low === null || close === null) {
        return null;
    }

    return {
        time,
        open,
        high,
        low,
        close,
        volume: absoluteNumber(item.trde_qty) || 0,
    };
}

function isAtOrAfter(candle, cutoff) {
    return new Date(candle.time).getTime() >= cutoff.getTime();
}

async function upsertInChunks(stockCode, candles, batchSize) {
    let rowCount = 0;

    for (let index = 0; index < candles.length; index += batchSize) {
        const chunk = candles.slice(index, index + batchSize);
        const result = await upsertCandles15m(stockCode, chunk);
        rowCount += result.rowCount || 0;
    }

    return rowCount;
}

async function fetchWithRetry(apiId, body, continuation, attempt = 1) {
    try {
        return await requestKiwoomTrWithHeaders(apiId, body, CHART_ENDPOINT, null, continuation);
    } catch (error) {
        if (attempt >= 3) throw error;
        const waitMs = attempt * 2_000;
        console.warn(`[retry] ${error.message} -> ${waitMs}ms wait`);
        await sleep(waitMs);
        return fetchWithRetry(apiId, body, continuation, attempt + 1);
    }
}

async function syncStock(stock, options, cutoff) {
    const body = {
        stk_cd: stock.code,
        tic_scope: TIC_SCOPE,
        upd_stkpc_tp: '1',
    };
    const seenTimes = new Set();
    const seenNextKeys = new Set();
    let continuation = { contYn: 'N', nextKey: '' };
    let page = 0;
    let totalRows = 0;
    let totalCandles = 0;

    while (true) {
        page += 1;
        const { headers, payload } = await fetchWithRetry(CHART_API_ID, body, continuation);

        if (payload.return_code !== 0) {
            throw new Error(payload.return_msg || JSON.stringify(payload));
        }

        const candles = getChartItems(payload)
            .map(normalizeCandle)
            .filter(Boolean);
        const selectedCandles = candles
            .filter((candle) => isAtOrAfter(candle, cutoff))
            .filter((candle) => {
                if (seenTimes.has(candle.time)) return false;
                seenTimes.add(candle.time);
                return true;
            })
            .reverse();

        if (selectedCandles.length) {
            totalRows += await upsertInChunks(stock.code, selectedCandles, options.batchSize);
            totalCandles += selectedCandles.length;
        }

        const oldest = candles.reduce((min, candle) => {
            const time = new Date(candle.time).getTime();
            return Math.min(min, time);
        }, Number.POSITIVE_INFINITY);
        const reachedCutoff = Number.isFinite(oldest) && oldest < cutoff.getTime();
        const hasNext = String(headers.contYn).toUpperCase() === 'Y' && headers.nextKey;

        console.log(
            `[${stock.code} ${stock.name || ''}] page=${page} candles=${selectedCandles.length} total=${totalCandles}`,
        );

        if (reachedCutoff || !hasNext) break;
        if (options.maxPagesPerStock && page >= options.maxPagesPerStock) break;
        if (seenNextKeys.has(headers.nextKey)) break;

        seenNextKeys.add(headers.nextKey);
        continuation = { contYn: headers.contYn, nextKey: headers.nextKey };
        await sleep(options.sleepMs);
    }

    return { rows: totalRows, candles: totalCandles, pages: page };
}

async function getTargetStocks(options) {
    if (options.codes.length) {
        return options.codes.map((code) => ({ code, name: '' }));
    }

    let stocks = await getStockList();
    if (options.startFrom) {
        const startIndex = stocks.findIndex((stock) => stock.code === options.startFrom);
        if (startIndex >= 0) stocks = stocks.slice(startIndex);
    }
    if (options.limitStocks > 0) {
        stocks = stocks.slice(0, options.limitStocks);
    }

    return stocks;
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        printHelp();
        return;
    }

    if (!process.env.POSTGRES_URL) {
        throw new Error('POSTGRES_URL is missing. Add it to .env before running this script.');
    }

    const cutoff = getCutoffDate(options.years);
    const stocks = await getTargetStocks(options);
    let succeeded = 0;
    let failed = 0;

    await query('SELECT 1');
    console.log(`Start sync: stocks=${stocks.length}, cutoff=${cutoff.toISOString()}, interval=15m`);

    for (let index = 0; index < stocks.length; index += 1) {
        const stock = stocks[index];

        try {
            const result = await syncStock(stock, options, cutoff);
            succeeded += 1;
            console.log(
                `[done ${index + 1}/${stocks.length}] ${stock.code} rows=${result.rows} pages=${result.pages}`,
            );
        } catch (error) {
            failed += 1;
            console.error(`[fail ${index + 1}/${stocks.length}] ${stock.code}: ${error.message}`);
        }

        await sleep(options.sleepMs);
    }

    console.log(`Finished. succeeded=${succeeded}, failed=${failed}`);
}

main()
    .catch((error) => {
        console.error(`[fatal] ${error.message}`);
        process.exitCode = 1;
    })
    .finally(async () => {
        await closePgPool();
    });
