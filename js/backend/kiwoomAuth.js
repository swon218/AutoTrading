//키움 설정 로드, 토큰 발급, TR 요청

const fs = require('fs');
const path = require('path');
const { REAL_HOST, REAL_WS_HOST, ROOT_DIR } = require('./config');

const TOKEN_REFRESH_BUFFER_MS = 10 * 60 * 1000;

let tokenCache = {
    token: '',
    expiresAt: 0,
};

function loadDotEnv() {
    const envPath = path.join(ROOT_DIR, '.env');
    if (!fs.existsSync(envPath)) return;

    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;

        const [key, ...valueParts] = trimmed.split('=');
        const value = valueParts.join('=').trim().replace(/^['"]|['"]$/g, '');
        if (!process.env[key.trim()]) {
            process.env[key.trim()] = value;
        }
    }
}

function loadFastPyKeys() {
    const fastPath = path.join(ROOT_DIR, 'fast.py');
    if (!fs.existsSync(fastPath)) return {};

    const text = fs.readFileSync(fastPath, 'utf8');
    const appkey = text.match(/^APPKEY\s*=\s*["'](.+)["']/m)?.[1] || '';
    const secretkey = text.match(/^SECRETKEY\s*=\s*["'](.+)["']/m)?.[1] || '';
    return { appkey, secretkey };
}

function getKiwoomConfig() {
    loadDotEnv();
    const fastPyKeys = loadFastPyKeys();

    const appkey = process.env.KIWOOM_APPKEY || fastPyKeys.appkey;
    const secretkey = process.env.KIWOOM_SECRETKEY || fastPyKeys.secretkey;
    if (!appkey || !secretkey) {
        throw new Error('KIWOOM_APPKEY / KIWOOM_SECRETKEY가 필요합니다. .env 또는 fast.py에 키를 넣어주세요.');
    }

    return {
        appkey,
        secretkey,
        host: REAL_HOST,
        wsHost: REAL_WS_HOST,
    };
}

async function requestKiwoomJson(url, headers, body) {
    const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(`Kiwoom API error ${response.status}: ${JSON.stringify(payload)}`);
    }

    return payload;
}

function parseKiwoomDateTime(value) {
    if (!value || value.length < 14) return 0;
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6)) - 1;
    const day = Number(value.slice(6, 8));
    const hour = Number(value.slice(8, 10));
    const minute = Number(value.slice(10, 12));
    const second = Number(value.slice(12, 14));
    return new Date(year, month, day, hour, minute, second).getTime();
}

async function getAccessToken() {
    const now = Date.now();
    if (tokenCache.token && tokenCache.expiresAt - TOKEN_REFRESH_BUFFER_MS > now) {
        return tokenCache.token;
    }

    const { appkey, secretkey, host } = getKiwoomConfig();
    const payload = await requestKiwoomJson(
        `${host}/oauth2/token`,
        { 'Content-Type': 'application/json;charset=UTF-8' },
        {
            grant_type: 'client_credentials',
            appkey,
            secretkey,
        },
    );

    if (!payload.token) {
        throw new Error(`토큰 발급 실패: ${JSON.stringify(payload)}`);
    }

    tokenCache = {
        token: payload.token,
        expiresAt: parseKiwoomDateTime(payload.expires_dt) || now + 60 * 60 * 1000,
    };

    return tokenCache.token;
}

async function requestKiwoomTr(apiId, body, endpoint = '/api/dostk/stkinfo') {
    const { host } = getKiwoomConfig();
    const token = await getAccessToken();

    const payload = await requestKiwoomJson(
        `${host}${endpoint}`,
        {
            'Content-Type': 'application/json;charset=UTF-8',
            authorization: `Bearer ${token}`,
            'cont-yn': 'N',
            'next-key': '',
            'api-id': apiId,
        },
        body,
    );

    const message = String(payload.return_msg || payload.message || '');
    if (message.includes('Token') || message.includes('토큰')) {
        tokenCache = {
            token: '',
            expiresAt: 0,
        };
        const freshToken = await getAccessToken();

        return requestKiwoomJson(
            `${host}${endpoint}`,
            {
                'Content-Type': 'application/json;charset=UTF-8',
                authorization: `Bearer ${freshToken}`,
                'cont-yn': 'N',
                'next-key': '',
                'api-id': apiId,
            },
            body,
        );
    }

    return payload;
}

module.exports = {
    getAccessToken,
    getKiwoomConfig,
    requestKiwoomTr,
};
