const crypto = require('crypto');
const { loadDotEnv } = require('./env');

function getBackendSupabaseConfig() {
    loadDotEnv();

    const url = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const encryptionKey = process.env.CREDENTIALS_ENCRYPTION_KEY;

    if (!url || !serviceKey || !encryptionKey) {
        throw new Error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CREDENTIALS_ENCRYPTION_KEY are required in .env.');
    }

    return {
        url: url.replace(/\/+$/, ''),
        serviceKey,
        encryptionKey,
    };
}

function getAuthorizationToken(request, requestUrl = null) {
    const header = request.headers.authorization || '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    return match?.[1] || requestUrl?.searchParams.get('access_token') || '';
}

function getGuestKiwoomCredentials() {
    loadDotEnv();

    const appkey = process.env.KIWOOM_APPKEY || process.env.app_key || '';
    const secretkey = process.env.KIWOOM_SECRETKEY || process.env.secret_key || '';
    if (!appkey || !secretkey) {
        const error = new Error('서비스 기본 Kiwoom API 키가 설정되지 않았습니다. .env에 KIWOOM_APPKEY / KIWOOM_SECRETKEY를 추가해주세요.');
        error.statusCode = 503;
        throw error;
    }

    return {
        appkey,
        secretkey,
        isGuest: true,
    };
}

function getEncryptionKey(rawKey) {
    if (/^[a-f0-9]{64}$/i.test(rawKey)) {
        return Buffer.from(rawKey, 'hex');
    }

    return crypto.createHash('sha256').update(rawKey).digest();
}

function encryptSecret(value, rawKey) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(rawKey), iv);
    const encrypted = Buffer.concat([
        cipher.update(String(value), 'utf8'),
        cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return [
        'v1',
        iv.toString('base64url'),
        tag.toString('base64url'),
        encrypted.toString('base64url'),
    ].join(':');
}

function normalizeTelegramBotToken(value) {
    const text = String(value || '')
        .replace(/\uFF1A/g, ':')
        .replace(/[\u200B-\u200D\uFEFF\s]/g, '')
        .trim();
    const match = text.match(/\d{6,}:[A-Za-z0-9_-]{20,}/);
    return match ? match[0] : text;
}

function decryptSecret(value, rawKey) {
    if (!value) return '';

    const [version, ivText, tagText, encryptedText] = String(value).split(':');
    if (version !== 'v1' || !ivText || !tagText || !encryptedText) {
        throw new Error('Stored credential format is invalid.');
    }

    const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        getEncryptionKey(rawKey),
        Buffer.from(ivText, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));

    return Buffer.concat([
        decipher.update(Buffer.from(encryptedText, 'base64url')),
        decipher.final(),
    ]).toString('utf8');
}

async function requestSupabaseJson(url, options) {
    const response = await fetch(url, options);
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;

    if (!response.ok) {
        const message = payload?.message || payload?.msg || text || `Supabase request failed: ${response.status}`;
        throw new Error(message);
    }

    return payload;
}

async function getSupabaseUser(accessToken, config) {
    if (!accessToken) {
        const error = new Error('Login is required.');
        error.statusCode = 401;
        throw error;
    }

    const user = await requestSupabaseJson(`${config.url}/auth/v1/user`, {
        headers: {
            apikey: config.serviceKey,
            Authorization: `Bearer ${accessToken}`,
        },
    });

    if (!user?.id) {
        const error = new Error('Login session is invalid.');
        error.statusCode = 401;
        throw error;
    }

    return user;
}

async function getAuthenticatedSupabaseUser(request, requestUrl = null) {
    const config = getBackendSupabaseConfig();
    const accessToken = getAuthorizationToken(request, requestUrl);
    return getSupabaseUser(accessToken, config);
}

async function saveUserApiCredentials(request, payload) {
    const config = getBackendSupabaseConfig();
    const accessToken = getAuthorizationToken(request);
    const user = await getSupabaseUser(accessToken, config);
    const existingRow = await getUserApiCredentialRow(user.id, config);
    const kiwoomAppKey = String(payload.kiwoomAppKey || '').trim();
    const kiwoomSecretKey = String(payload.kiwoomSecretKey || '').trim();
    const telegramBotToken = normalizeTelegramBotToken(payload.telegramBotToken);
    const telegramChatId = String(payload.telegramChatId || '').trim();
    const hasKiwoomAppKey = Boolean(kiwoomAppKey);
    const hasKiwoomSecretKey = Boolean(kiwoomSecretKey);
    const hasTelegramBotToken = Boolean(telegramBotToken);
    const hasTelegramChatId = Boolean(telegramChatId);

    if (hasKiwoomAppKey !== hasKiwoomSecretKey) {
        const error = new Error('키움 앱키와 시크릿키는 함께 입력해야 합니다.');
        error.statusCode = 400;
        throw error;
    }
    if (hasTelegramBotToken !== hasTelegramChatId) {
        const error = new Error('텔레그램 봇 토큰과 Chat ID는 함께 입력해야 합니다.');
        error.statusCode = 400;
        throw error;
    }
    if (!hasKiwoomAppKey && !hasTelegramBotToken) {
        const error = new Error('저장할 키 정보를 입력하세요.');
        error.statusCode = 400;
        throw error;
    }

    const row = {
        user_id: user.id,
        updated_at: new Date().toISOString(),
    };

    if (hasKiwoomAppKey) {
        row.kiwoom_app_key_encrypted = encryptSecret(kiwoomAppKey, config.encryptionKey);
        row.kiwoom_secret_key_encrypted = encryptSecret(kiwoomSecretKey, config.encryptionKey);
    }
    if (hasTelegramBotToken) {
        row.telegram_bot_token_encrypted = encryptSecret(telegramBotToken, config.encryptionKey);
        row.telegram_chat_id_encrypted = encryptSecret(telegramChatId, config.encryptionKey);
        row.telegram_verified_at = null;
    }

    const url = existingRow
        ? `${config.url}/rest/v1/user_api_credentials?user_id=eq.${encodeURIComponent(user.id)}`
        : `${config.url}/rest/v1/user_api_credentials`;

    await requestSupabaseJson(url, {
        method: existingRow ? 'PATCH' : 'POST',
        headers: {
            apikey: config.serviceKey,
            Authorization: `Bearer ${config.serviceKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(row),
    });

    return { ok: true };
}

async function getUserApiCredentialRow(userId, config) {
    const rows = await requestSupabaseJson(
        `${config.url}/rest/v1/user_api_credentials?user_id=eq.${encodeURIComponent(userId)}&select=kiwoom_app_key_encrypted,kiwoom_secret_key_encrypted,telegram_bot_token_encrypted,telegram_chat_id_encrypted,telegram_verified_at&limit=1`,
        {
            headers: {
                apikey: config.serviceKey,
                Authorization: `Bearer ${config.serviceKey}`,
            },
        },
    );

    return Array.isArray(rows) ? rows[0] : null;
}

async function getKiwoomCredentialsForRequest(request, requestUrl = null) {
    const config = getBackendSupabaseConfig();
    const accessToken = getAuthorizationToken(request, requestUrl);
    const user = await getSupabaseUser(accessToken, config);
    const row = await getUserApiCredentialRow(user.id, config);

    if (!row?.kiwoom_app_key_encrypted || !row?.kiwoom_secret_key_encrypted) {
        const error = new Error('회원정보수정에서 Kiwoom API 앱키와 시크릿키를 추가 후 이용해주세요.');
        error.statusCode = 403;
        throw error;
    }

    return {
        appkey: decryptSecret(row.kiwoom_app_key_encrypted, config.encryptionKey),
        secretkey: decryptSecret(row.kiwoom_secret_key_encrypted, config.encryptionKey),
        telegramBotToken: row.telegram_bot_token_encrypted
            ? decryptSecret(row.telegram_bot_token_encrypted, config.encryptionKey)
            : '',
        telegramChatId: row.telegram_chat_id_encrypted
            ? decryptSecret(row.telegram_chat_id_encrypted, config.encryptionKey)
            : '',
    };
}

async function getKiwoomCredentialsForReadRequest(request, requestUrl = null) {
    const accessToken = getAuthorizationToken(request, requestUrl);
    if (!accessToken) {
        return getGuestKiwoomCredentials();
    }

    return getKiwoomCredentialsForRequest(request, requestUrl);
}

async function getUserKiwoomCredentialsById(userId) {
    const config = getBackendSupabaseConfig();
    const row = await getUserApiCredentialRow(userId, config);

    if (!row?.kiwoom_app_key_encrypted || !row?.kiwoom_secret_key_encrypted) {
        return null;
    }

    return {
        appkey: decryptSecret(row.kiwoom_app_key_encrypted, config.encryptionKey),
        secretkey: decryptSecret(row.kiwoom_secret_key_encrypted, config.encryptionKey),
        telegramBotToken: row.telegram_bot_token_encrypted
            ? decryptSecret(row.telegram_bot_token_encrypted, config.encryptionKey)
            : '',
        telegramChatId: row.telegram_chat_id_encrypted
            ? decryptSecret(row.telegram_chat_id_encrypted, config.encryptionKey)
            : '',
    };
}

async function getUserIntegrationStatus(request, requestUrl = null) {
    const config = getBackendSupabaseConfig();
    const accessToken = getAuthorizationToken(request, requestUrl);
    const user = await getSupabaseUser(accessToken, config);
    const row = await getUserApiCredentialRow(user.id, config);

    return {
        kiwoomConfigured: Boolean(row?.kiwoom_app_key_encrypted && row?.kiwoom_secret_key_encrypted),
        telegramConfigured: Boolean(row?.telegram_bot_token_encrypted && row?.telegram_chat_id_encrypted),
        telegramVerified: Boolean(row?.telegram_bot_token_encrypted && row?.telegram_chat_id_encrypted && row?.telegram_verified_at),
    };
}

module.exports = {
    getAuthenticatedSupabaseUser,
    getBackendSupabaseConfig,
    getUserIntegrationStatus,
    getKiwoomCredentialsForReadRequest,
    getKiwoomCredentialsForRequest,
    getUserKiwoomCredentialsById,
    requestSupabaseJson,
    saveUserApiCredentials,
};
