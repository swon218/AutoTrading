const crypto = require('crypto');
const {
    getAuthenticatedSupabaseUser,
    getBackendSupabaseConfig,
    getKiwoomCredentialsForRequest,
    requestSupabaseJson,
} = require('./userCredentials');

const VERIFICATION_TTL_MS = 10 * 60 * 1000;

function getHeaders(config) {
    return {
        apikey: config.serviceKey,
        Authorization: `Bearer ${config.serviceKey}`,
        'Content-Type': 'application/json',
    };
}

function hashVerificationCode(userId, code, encryptionKey) {
    return crypto
        .createHmac('sha256', encryptionKey)
        .update(`${userId}:${code}`)
        .digest('hex');
}

function generateVerificationCode() {
    return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

async function sendTelegramMessage(botToken, chatId, text) {
    if (!botToken || !chatId) {
        const error = new Error('Telegram bot token and chat ID are required.');
        error.statusCode = 400;
        throw error;
    }

    const response = await fetch(`https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
            chat_id: chatId,
            text,
            disable_web_page_preview: true,
        }),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || payload.ok === false) {
        const message = payload.description || `Telegram request failed: ${response.status}`;
        const error = new Error(message);
        error.statusCode = response.status || 500;
        throw error;
    }

    return payload;
}

async function startTelegramVerification(request, requestUrl = null) {
    const config = getBackendSupabaseConfig();
    const user = await getAuthenticatedSupabaseUser(request, requestUrl);
    const credentials = await getKiwoomCredentialsForRequest(request, requestUrl);
    if (!credentials.telegramBotToken || !credentials.telegramChatId) {
        const error = new Error('Telegram bot token and chat ID are not registered.');
        error.statusCode = 403;
        throw error;
    }

    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS).toISOString();

    await sendTelegramMessage(
        credentials.telegramBotToken,
        credentials.telegramChatId,
        [
            'AutoTrading 텔레그램 인증코드입니다.',
            '',
            `인증코드: ${code}`,
            '10분 안에 자동매매 탭에 입력해 주세요.',
        ].join('\n'),
    );

    await requestSupabaseJson(
        `${config.url}/rest/v1/user_api_credentials?user_id=eq.${encodeURIComponent(user.id)}`,
        {
            method: 'PATCH',
            headers: getHeaders(config),
            body: JSON.stringify({
                telegram_verified_at: null,
                telegram_verification_code_hash: hashVerificationCode(user.id, code, config.encryptionKey),
                telegram_verification_expires_at: expiresAt,
                updated_at: new Date().toISOString(),
            }),
        },
    );

    return { ok: true, expiresAt };
}

async function confirmTelegramVerification(request, payload = {}, requestUrl = null) {
    const config = getBackendSupabaseConfig();
    const user = await getAuthenticatedSupabaseUser(request, requestUrl);
    const code = String(payload.code || '').replace(/[^\d]/g, '');

    if (!/^\d{6}$/.test(code)) {
        const error = new Error('6자리 인증코드를 입력하세요.');
        error.statusCode = 400;
        throw error;
    }

    const rows = await requestSupabaseJson(
        `${config.url}/rest/v1/user_api_credentials?user_id=eq.${encodeURIComponent(user.id)}&select=telegram_verification_code_hash,telegram_verification_expires_at&limit=1`,
        { headers: getHeaders(config) },
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    const expiresAt = row?.telegram_verification_expires_at
        ? new Date(row.telegram_verification_expires_at).getTime()
        : 0;
    const expectedHash = row?.telegram_verification_code_hash || '';
    const actualHash = hashVerificationCode(user.id, code, config.encryptionKey);

    if (!expectedHash || !expiresAt || expiresAt < Date.now()) {
        const error = new Error('인증코드가 만료되었습니다. 인증하기를 다시 눌러주세요.');
        error.statusCode = 400;
        throw error;
    }
    if (actualHash !== expectedHash) {
        const error = new Error('인증코드가 일치하지 않습니다.');
        error.statusCode = 400;
        throw error;
    }

    const verifiedAt = new Date().toISOString();
    await requestSupabaseJson(
        `${config.url}/rest/v1/user_api_credentials?user_id=eq.${encodeURIComponent(user.id)}`,
        {
            method: 'PATCH',
            headers: getHeaders(config),
            body: JSON.stringify({
                telegram_verified_at: verifiedAt,
                telegram_verification_code_hash: null,
                telegram_verification_expires_at: null,
                updated_at: verifiedAt,
            }),
        },
    );

    return { ok: true, verifiedAt };
}

async function testTelegramConnection(request, requestUrl = null) {
    return startTelegramVerification(request, requestUrl);
}

module.exports = {
    confirmTelegramVerification,
    sendTelegramMessage,
    startTelegramVerification,
    testTelegramConnection,
};
