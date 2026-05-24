//실시간 WebSocket, SSE 구독

const { getAccessToken, getKiwoomConfig } = require('./kiwoomAuth');
const { resolveStockCode } = require('./stocks');
const { absoluteNumber, signedNumber } = require('./kiwoomUtils');

const realtimeClients = new Set();

let kiwoomSocket = null;
let kiwoomSocketReady = false;
let currentRealtimeCode = '';
let reconnectTimer = null;

function hmsToIsoToday(value) {
    const text = String(value || '');
    if (!/^\d{6}$/.test(text)) return new Date().toISOString();

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}T${text.slice(0, 2)}:${text.slice(2, 4)}:${text.slice(4, 6)}+09:00`;
}

function parseRealValues(values) {
    if (!values) return {};
    if (typeof values === 'string') {
        try {
            return JSON.parse(values);
        } catch {
            return {};
        }
    }
    return values;
}

function normalizeRealtimeMessage(message) {
    let payload;
    try {
        payload = typeof message === 'string' ? JSON.parse(message) : JSON.parse(String(message));
    } catch {
        return [];
    }

    const dataList = Array.isArray(payload.data) ? payload.data : [];
    const ticks = [];

    for (const item of dataList) {
        if (item.type !== '0B') continue;

        const values = parseRealValues(item.values);
        const rawCode = String(item.item || '').split('_')[0].replace(/^A/i, '');
        const code = rawCode || currentRealtimeCode;
        const price = absoluteNumber(values['10']);
        const change = signedNumber(values['11']);
        const changeRate = signedNumber(values['12']);
        const tradeVolume = absoluteNumber(values['15']);
        const accumulatedVolume = absoluteNumber(values['13']);
        const high = absoluteNumber(values['17']);
        const low = absoluteNumber(values['18']);
        const tradeTime = values['20'];

        if (!code || price === null) continue;

        ticks.push({
            code,
            price,
            change,
            changeRate,
            tradeVolume,
            volume: accumulatedVolume,
            high,
            low,
            time: hmsToIsoToday(tradeTime),
            direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
        });
    }

    return ticks;
}

function sendRealtimeEvent(client, event, data) {
    client.write(`event: ${event}\n`);
    client.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcastRealtime(event, data) {
    for (const client of realtimeClients) {
        sendRealtimeEvent(client, event, data);
    }
}

function sendKiwoomWsMessage(payload) {
    if (!kiwoomSocket || kiwoomSocket.readyState !== WebSocket.OPEN) return;
    kiwoomSocket.send(JSON.stringify(payload));
}

function registerRealtimeCode(code) {
    if (!code || !kiwoomSocketReady) return;

    currentRealtimeCode = code;
    sendKiwoomWsMessage({
        trnm: 'REG',
        grp_no: '1',
        refresh: '0',
        data: [
            {
                item: [code],
                type: ['0B'],
            },
        ],
    });
}

async function connectKiwoomWebSocket(code = currentRealtimeCode, credentials = null) {
    if (typeof WebSocket === 'undefined') {
        throw new Error('현재 Node.js에서 WebSocket 클라이언트를 사용할 수 없습니다.');
    }

    if (kiwoomSocket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(kiwoomSocket.readyState)) {
        if (code && code !== currentRealtimeCode) {
            registerRealtimeCode(code);
        }
        return;
    }

    const { wsHost } = getKiwoomConfig(credentials);
    const token = await getAccessToken(credentials);

    kiwoomSocketReady = false;
    currentRealtimeCode = code || currentRealtimeCode;
    kiwoomSocket = new WebSocket(`${wsHost}/api/dostk/websocket`);

    kiwoomSocket.addEventListener('open', () => {
        sendKiwoomWsMessage({
            trnm: 'LOGIN',
            token,
        });
    });

    kiwoomSocket.addEventListener('message', (event) => {
        let payload = {};
        try {
            payload = JSON.parse(event.data);
        } catch {
            payload = {};
        }

        if (payload.trnm === 'LOGIN') {
            kiwoomSocketReady = true;
            registerRealtimeCode(currentRealtimeCode);
            broadcastRealtime('status', { connected: true });
            return;
        }

        const ticks = normalizeRealtimeMessage(event.data);
        for (const tick of ticks) {
            broadcastRealtime('tick', tick);
        }
    });

    kiwoomSocket.addEventListener('close', () => {
        kiwoomSocketReady = false;
        broadcastRealtime('status', { connected: false });

        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
            connectKiwoomWebSocket(currentRealtimeCode, credentials).catch((error) => {
                console.error('Kiwoom WebSocket reconnect failed:', error.message);
            });
        }, 3000);
    });

    kiwoomSocket.addEventListener('error', () => {
        kiwoomSocketReady = false;
    });
}

async function subscribeRealtime(request, response, query, credentials = null) {
    response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    response.write('\n');
    realtimeClients.add(response);

    try {
        const code = await resolveStockCode(query, credentials);
        sendRealtimeEvent(response, 'status', { connected: false, code });
        await connectKiwoomWebSocket(code, credentials);
        registerRealtimeCode(code);
    } catch (error) {
        sendRealtimeEvent(response, 'error', { message: error.message });
    }

    request.on('close', () => {
        realtimeClients.delete(response);
    });
}

module.exports = {
    subscribeRealtime,
};
