const { getKiwoomCredentialsForRequest } = require('./userCredentials');

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

async function testTelegramConnection(request, requestUrl = null) {
    const credentials = await getKiwoomCredentialsForRequest(request, requestUrl);
    if (!credentials.telegramBotToken || !credentials.telegramChatId) {
        const error = new Error('Telegram bot token and chat ID are not registered.');
        error.statusCode = 403;
        throw error;
    }

    await sendTelegramMessage(
        credentials.telegramBotToken,
        credentials.telegramChatId,
        'AutoTrading 텔레그램 연동 테스트 메시지입니다.',
    );

    return { ok: true };
}

module.exports = {
    sendTelegramMessage,
    testTelegramConnection,
};
