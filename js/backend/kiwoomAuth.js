//키움 설정 로드, 토큰 발급, TR 요청

const fs = require('fs');
const path = require('path');
const { REAL_HOST, REAL_WS_HOST, ROOT_DIR } = require('./config');

const TOKEN_REFRESH_BUFFER_MS = 10 * 60 * 1000;
const KIWOOM_TERMINAL_AUTH_GUIDE = '키움 REST API 지정단말기 인증 실패입니다. PC/서버의 공인 IP가 바뀐 경우 키움증권 홈페이지 REST API 메뉴에서 현재 IP 주소를 추가하거나 변경하세요.';

let tokenCache = {
    default: {
        token: '',
        expiresAt: 0,
    },
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

function getKiwoomConfig(credentials = null) {
    if (credentials?.appkey && credentials?.secretkey) {
        return {
            appkey: credentials.appkey,
            secretkey: credentials.secretkey,
            host: REAL_HOST,
            wsHost: REAL_WS_HOST,
        };
    }

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

function formatTokenIssue(payload) {
    const rawPayload = JSON.stringify(payload);
    const message = String(payload.return_msg || payload.message || rawPayload);
    const isTerminalAuthFailure = message.includes('8050') || message.includes('지정단말기');
    const guide = isTerminalAuthFailure ? ` ${KIWOOM_TERMINAL_AUTH_GUIDE}` : '';
    return `토큰 발급 실패: ${rawPayload}${guide}`;
}

function getTokenCacheKey(credentials = null) {
    if (!credentials?.appkey) return 'default';
    return `user:${credentials.appkey.slice(0, 8)}:${credentials.appkey.length}`;
}

async function getAccessToken(credentials = null) {
    const now = Date.now();
    const cacheKey = getTokenCacheKey(credentials);
    const cached = tokenCache[cacheKey] || { token: '', expiresAt: 0 };
    if (cached.token && cached.expiresAt - TOKEN_REFRESH_BUFFER_MS > now) {
        return cached.token;
    }

    const { appkey, secretkey, host } = getKiwoomConfig(credentials);
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
        throw new Error(formatTokenIssue(payload));
    }

    tokenCache[cacheKey] = {
        token: payload.token,
        expiresAt: parseKiwoomDateTime(payload.expires_dt) || now + 60 * 60 * 1000,
    };

    return tokenCache[cacheKey].token;
}

async function requestKiwoomTr(apiId, body, endpoint = '/api/dostk/stkinfo', credentials = null) {
    const { host } = getKiwoomConfig(credentials);
    const token = await getAccessToken(credentials);

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
        tokenCache[getTokenCacheKey(credentials)] = {
            token: '',
            expiresAt: 0,
        };
        const freshToken = await getAccessToken(credentials);

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
    formatTokenIssue,
    getAccessToken,
    getKiwoomConfig,
    requestKiwoomTr,
};
