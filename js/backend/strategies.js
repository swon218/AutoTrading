//지표 전략 저장/수정/삭제

const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const { DATA_DIR, DB_PATH } = require('./config');

const DEFAULT_INDICATOR_STRATEGIES = [
    {
        name: '1번',
        indicators: [
            { key: 'rsi', values: { period: 14, lower: 30, upper: 70 } },
        ],
    },
    {
        name: '2번',
        indicators: [
            { key: 'rsi', values: { period: 14, lower: 30, upper: 70 } },
            { key: 'ma', values: { maType: 'sma', short: 5, long: 20 } },
        ],
    },
    {
        name: 'A전략',
        indicators: [
            { key: 'bollinger', values: { period: 20, deviation: 2 } },
            { key: 'macd', values: { fast: 12, slow: 26, signal: 9 } },
        ],
    },
];

let database = null;

function getDatabase() {
    if (database) return database;

    fs.mkdirSync(DATA_DIR, { recursive: true });
    database = new DatabaseSync(DB_PATH);
    database.exec(`
        CREATE TABLE IF NOT EXISTS indicator_strategies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            config_json TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);

    const strategyCount = database.prepare('SELECT COUNT(*) AS count FROM indicator_strategies').get().count;
    if (!strategyCount) {
        const insert = database.prepare(`
            INSERT INTO indicator_strategies (name, config_json)
            VALUES (?, ?)
        `);
        for (const strategy of DEFAULT_INDICATOR_STRATEGIES) {
            insert.run(strategy.name, JSON.stringify(strategy.indicators));
        }
    }

    return database;
}

function strategyRowToDto(row) {
    return {
        id: String(row.id),
        name: row.name,
        indicators: JSON.parse(row.config_json),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function normalizeStrategyName(name) {
    return String(name || '').replace(/\s+/g, '').toLowerCase();
}

function getIndicatorStrategies() {
    const db = getDatabase();
    return db.prepare(`
        SELECT id, name, config_json, created_at, updated_at
        FROM indicator_strategies
        ORDER BY id ASC
    `).all().map(strategyRowToDto);
}

function createIndicatorStrategy(payload) {
    const name = String(payload.name || '').trim();
    const indicators = Array.isArray(payload.indicators) ? payload.indicators : [];

    if (!name) throw new Error('Strategy name is required.');
    if (!indicators.length) throw new Error('At least one indicator is required.');

    const db = getDatabase();
    const duplicate = db.prepare('SELECT id, name FROM indicator_strategies').all()
        .find((strategy) => normalizeStrategyName(strategy.name) === normalizeStrategyName(name));
    if (duplicate) throw new Error('Strategy name already exists.');

    const result = db.prepare(`
        INSERT INTO indicator_strategies (name, config_json)
        VALUES (?, ?)
    `).run(name, JSON.stringify(indicators));

    const row = db.prepare(`
        SELECT id, name, config_json, created_at, updated_at
        FROM indicator_strategies
        WHERE id = ?
    `).get(result.lastInsertRowid);

    return strategyRowToDto(row);
}

function updateIndicatorStrategy(id, payload) {
    const name = String(payload.name || '').trim();
    const indicators = Array.isArray(payload.indicators) ? payload.indicators : [];

    if (!name) throw new Error('Strategy name is required.');
    if (!indicators.length) throw new Error('At least one indicator is required.');

    const db = getDatabase();
    const duplicate = db.prepare('SELECT id, name FROM indicator_strategies WHERE id != ?').all(id)
        .find((strategy) => normalizeStrategyName(strategy.name) === normalizeStrategyName(name));
    if (duplicate) throw new Error('Strategy name already exists.');

    const result = db.prepare(`
        UPDATE indicator_strategies
        SET name = ?, config_json = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(name, JSON.stringify(indicators), id);

    if (!result.changes) throw new Error('Strategy not found.');

    const row = db.prepare(`
        SELECT id, name, config_json, created_at, updated_at
        FROM indicator_strategies
        WHERE id = ?
    `).get(id);

    return strategyRowToDto(row);
}

function deleteIndicatorStrategy(id) {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM indicator_strategies WHERE id = ?').run(id);
    if (!result.changes) throw new Error('Strategy not found.');
}

module.exports = {
    createIndicatorStrategy,
    deleteIndicatorStrategy,
    getIndicatorStrategies,
    updateIndicatorStrategy,
};
