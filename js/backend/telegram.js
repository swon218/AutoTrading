const crypto = require('crypto');
const {
    getAuthenticatedSupabaseUser,
    getBackendSupabaseConfig,
    getKiwoomCredentialsForRequest,
    requestSupabaseJson,
} = require('./userCredentials');

const VERIFICATION_TTL_MS = 10 * 60 * 1000;
const pendingTelegramVerifications = new Map();

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

function normalizeTelegramBotToken(value) {
    const text = String(value || '')
        .replace(/\uFF1A/g, ':')
        .replace(/[\u200B-\u200D\uFEFF\s]/g, '')
        .trim();
    const match = text.match(/\d{6,}:[A-Za-z0-9_-]{20,}/);
    return match ? match[0] : text;
}

async function sendTelegramMessage(botToken, chatId, text) {
    const normalizedBotToken = normalizeTelegramBotToken(botToken);
    const normalizedChatId = String(chatId || '').trim();

    if (!normalizedBotToken || !normalizedChatId) {
        const error = new Error('Telegram bot token and chat ID are required.');
        error.statusCode = 400;
        throw error;
    }
    if (!/^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(normalizedBotToken)) {
        const error = new Error('텔레그램 봇 토큰 형식이 올바르지 않습니다. BotFather에서 받은 전체 토큰을 입력하세요.');
        error.statusCode = 400;
        throw error;
    }

    const response = await fetch(`https://api.telegram.org/bot${normalizedBotToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
            chat_id: normalizedChatId,
            text,
            disable_web_page_preview: true,
        }),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || payload.ok === false) {
        const description = String(payload.description || '').trim();
        let message = description || `Telegram request failed: ${response.status}`;
        if (response.status === 404 && /not found/i.test(description)) {
            message = '텔레그램 봇 토큰을 찾지 못했습니다. BotFather에서 받은 토큰을 다시 확인하세요.';
        } else if (/chat not found/i.test(description)) {
            message = '텔레그램 Chat ID를 찾지 못했습니다. 봇에게 /start를 먼저 보낸 뒤 Chat ID를 다시 확인하세요.';
        } else if (/bot was blocked/i.test(description)) {
            message = '텔레그램 봇이 차단되어 있습니다. 텔레그램에서 봇 차단을 해제하세요.';
        }
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

    pendingTelegramVerifications.set(user.id, {
        hash: hashVerificationCode(user.id, code, config.encryptionKey),
        expiresAt: new Date(expiresAt).getTime(),
    });

    await requestSupabaseJson(
        `${config.url}/rest/v1/user_api_credentials?user_id=eq.${encodeURIComponent(user.id)}`,
        {
            method: 'PATCH',
            headers: getHeaders(config),
            body: JSON.stringify({
                telegram_verified_at: null,
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

    const pending = pendingTelegramVerifications.get(user.id);
    const expiresAt = pending?.expiresAt || 0;
    const expectedHash = pending?.hash || '';
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
    pendingTelegramVerifications.delete(user.id);
    await requestSupabaseJson(
        `${config.url}/rest/v1/user_api_credentials?user_id=eq.${encodeURIComponent(user.id)}`,
        {
            method: 'PATCH',
            headers: getHeaders(config),
            body: JSON.stringify({
                telegram_verified_at: verifiedAt,
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
