const crypto = require('crypto');
const { loadDotEnv } = require('./env');

const REQUIRED_FIELDS = [
    'kiwoomAppKey',
    'kiwoomSecretKey',
];

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

function validateCredentialPayload(payload) {
    for (const field of REQUIRED_FIELDS) {
        if (!String(payload?.[field] || '').trim()) {
            const error = new Error('Kiwoom app key and Kiwoom secret key are required.');
            error.statusCode = 400;
            throw error;
        }
    }
}

async function saveUserApiCredentials(request, payload) {
    validateCredentialPayload(payload);

    const config = getBackendSupabaseConfig();
    const accessToken = getAuthorizationToken(request);
    const user = await getSupabaseUser(accessToken, config);

    const row = {
        user_id: user.id,
        kiwoom_app_key_encrypted: encryptSecret(payload.kiwoomAppKey.trim(), config.encryptionKey),
        kiwoom_secret_key_encrypted: encryptSecret(payload.kiwoomSecretKey.trim(), config.encryptionKey),
        telegram_bot_token_encrypted: payload.telegramBotToken?.trim()
            ? encryptSecret(payload.telegramBotToken.trim(), config.encryptionKey)
            : null,
        updated_at: new Date().toISOString(),
    };

    await requestSupabaseJson(`${config.url}/rest/v1/user_api_credentials?on_conflict=user_id`, {
        method: 'POST',
        headers: {
            apikey: config.serviceKey,
            Authorization: `Bearer ${config.serviceKey}`,
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates',
        },
        body: JSON.stringify(row),
    });

    return { ok: true };
}

async function getUserApiCredentialRow(userId, config) {
    const rows = await requestSupabaseJson(
        `${config.url}/rest/v1/user_api_credentials?user_id=eq.${encodeURIComponent(userId)}&select=kiwoom_app_key_encrypted,kiwoom_secret_key_encrypted,telegram_bot_token_encrypted&limit=1`,
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
        const error = new Error('Kiwoom API keys are not registered. Please add them in account settings.');
        error.statusCode = 403;
        throw error;
    }

    return {
        appkey: decryptSecret(row.kiwoom_app_key_encrypted, config.encryptionKey),
        secretkey: decryptSecret(row.kiwoom_secret_key_encrypted, config.encryptionKey),
        telegramBotToken: row.telegram_bot_token_encrypted
            ? decryptSecret(row.telegram_bot_token_encrypted, config.encryptionKey)
            : '',
    };
}

module.exports = {
    getAuthenticatedSupabaseUser,
    getBackendSupabaseConfig,
    getKiwoomCredentialsForRequest,
    requestSupabaseJson,
    saveUserApiCredentials,
};
