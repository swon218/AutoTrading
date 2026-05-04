//공통 경로/호스트 설정

const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const REAL_HOST = 'https://api.kiwoom.com';
const REAL_WS_HOST = 'wss://api.kiwoom.com:10000';
const DATA_DIR = path.join(ROOT_DIR, 'data');
const DB_PATH = path.join(DATA_DIR, 'stockman.db');

module.exports = {
    ROOT_DIR,
    REAL_HOST,
    REAL_WS_HOST,
    DATA_DIR,
    DB_PATH,
};
