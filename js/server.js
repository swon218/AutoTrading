// 서버 시작, 라우팅, 정적 파일 제공

const http = require('http');
const fs = require('fs');
const path = require('path');
const { ROOT_DIR } = require('./backend/config');
const { getChartData } = require('./backend/charts');
const { getStrategyChartData } = require('./backend/strategyCharts');
const {
    createIndicatorStrategy,
    deleteIndicatorStrategy,
    getIndicatorStrategies,
    updateIndicatorStrategy,
} = require('./backend/strategies');
const { getOrderableCash, getPortfolio, getStockHolding } = require('./backend/account');
const {
    cancelStockOrder,
    getPendingOrders,
    modifyStockOrder,
    placeStockOrder,
} = require('./backend/orders');
const { getHomeRanking } = require('./backend/rankings');
const { getStockInfo, resolveStockCode, searchStocks } = require('./backend/stocks');
const { subscribeRealtime } = require('./backend/realtime');
const {
    getKiwoomCredentialsForReadRequest,
    getKiwoomCredentialsForRequest,
    getUserIntegrationStatus,
    saveUserApiCredentials,
} = require('./backend/userCredentials');
const {
    getAutoTradeRules,
    saveAutoTradeRule,
    updateAutoTradeRuleEnabled,
} = require('./backend/autoTradeRules');
const {
    getAutoTradeEngineStatus,
    startAutoTradeEngine,
} = require('./backend/autoTradeEngine');
const {
    confirmTelegramVerification,
    startTelegramVerification,
    testTelegramConnection,
} = require('./backend/telegram');
const {
    createWatchlist,
    deleteWatchlist,
    getWatchlistQuotes,
    getWatchlists,
    updateWatchlist,
} = require('./backend/watchlists');
const { getEconomicNews } = require('./backend/news');

const PORT = Number(process.env.PORT || 3000);

function getRequestUrl(request) {
    const host = request.headers.host || `localhost:${PORT}`;
    const protocol = request.headers['x-forwarded-proto'] || 'http';
    return new URL(request.url || '/', `${protocol}://${host}`);
}

function parseRequestBody(request) {
    return new Promise((resolve, reject) => {
        let body = '';

        request.on('data', (chunk) => {
            body += chunk;
            if (body.length > 1024 * 1024) {
                reject(new Error('Request body is too large.'));
                request.destroy();
            }
        });

        request.on('end', () => {
            if (!body) {
                resolve({});
                return;
            }

            try {
                resolve(JSON.parse(body));
            } catch {
                reject(new Error('Invalid JSON body.'));
            }
        });

        request.on('error', reject);
    });
}

function sendJson(response, statusCode, payload) {
    response.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
    });
    response.end(JSON.stringify(payload));
}

function sendStatic(request, response) {
    const requestUrl = getRequestUrl(request);
    let pathname;

    try {
        pathname = decodeURIComponent(requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname);
    } catch {
        response.writeHead(400);
        response.end('Bad request');
        return;
    }

    const filePath = path.normalize(path.join(ROOT_DIR, pathname));

    if (!filePath.startsWith(ROOT_DIR)) {
        response.writeHead(403);
        response.end('Forbidden');
        return;
    }

    fs.readFile(filePath, (error, data) => {
        if (error) {
            response.writeHead(404);
            response.end('Not found');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentTypes = {
            '.html': 'text/html; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.js': 'application/javascript; charset=utf-8',
            '.json': 'application/json; charset=utf-8',
        };

        response.writeHead(200, {
            'Content-Type': contentTypes[ext] || 'application/octet-stream',
        });
        response.end(data);
    });
}

const server = http.createServer(async (request, response) => {
    const requestUrl = getRequestUrl(request);
    const stockMatch = requestUrl.pathname.match(/^\/api\/stock\/(.+)$/);
    const chartMatch = requestUrl.pathname.match(/^\/api\/chart\/(.+)$/);
    const strategyChartMatch = requestUrl.pathname.match(/^\/api\/strategy-chart\/(.+)$/);
    const realtimeMatch = requestUrl.pathname.match(/^\/api\/realtime\/(.+)$/);
    const strategyMatch = requestUrl.pathname.match(/^\/api\/indicator-strategies\/([^/]+)$/);
    const autoTradeRuleMatch = requestUrl.pathname.match(/^\/api\/auto-trade-rules\/([^/]+)$/);
    const autoTradeRuleStartMatch = requestUrl.pathname.match(/^\/api\/auto-trade-rules\/([^/]+)\/start$/);
    const autoTradeRuleStopMatch = requestUrl.pathname.match(/^\/api\/auto-trade-rules\/([^/]+)\/stop$/);
    const watchlistMatch = requestUrl.pathname.match(/^\/api\/watchlists\/([^/]+)$/);
    const watchlistQuotesMatch = requestUrl.pathname.match(/^\/api\/watchlists\/([^/]+)\/quotes$/);

    if (request.method === 'GET' && requestUrl.pathname === '/api/health') {
        sendJson(response, 200, { ok: true });
        return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/search') {
        try {
            const query = requestUrl.searchParams.get('q') || '';
            const credentials = await getKiwoomCredentialsForReadRequest(request, requestUrl);
            const results = await searchStocks(query, 10, credentials);
            sendJson(response, 200, { results });
        } catch (error) {
            sendJson(response, error.statusCode || 500, { message: error.message });
        }
        return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/home-rankings') {
        try {
            const type = requestUrl.searchParams.get('type') || 'realtime';
            const limit = requestUrl.searchParams.get('limit') || '10';
            const credentials = await getKiwoomCredentialsForReadRequest(request, requestUrl);
            const ranking = await getHomeRanking(type, limit, credentials);
            sendJson(response, 200, ranking);
        } catch (error) {
            sendJson(response, error.statusCode || 500, { message: error.message });
        }
        return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/news') {
        try {
            const query = requestUrl.searchParams.get('q') || '\uACBD\uC81C';
            const display = requestUrl.searchParams.get('display') || '15';
            const start = requestUrl.searchParams.get('start') || '1';
            const news = await getEconomicNews({ query, display, start });
            sendJson(response, 200, news);
        } catch (error) {
            sendJson(response, error.statusCode || 500, { message: error.message });
        }
        return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/watchlists') {
        try {
            const result = await getWatchlists(request, requestUrl);
            sendJson(response, 200, result);
        } catch (error) {
            sendJson(response, error.statusCode || 500, { message: error.message });
        }
        return;
    }

    if (request.method === 'POST' && requestUrl.pathname === '/api/watchlists') {
        try {
            const payload = await parseRequestBody(request);
            const result = await createWatchlist(request, payload, requestUrl);
            sendJson(response, 201, result);
        } catch (error) {
            sendJson(response, error.statusCode || 400, { message: error.message });
        }
        return;
    }

    if (request.method === 'GET' && watchlistQuotesMatch) {
        try {
            const groupId = decodeURIComponent(watchlistQuotesMatch[1]);
            const credentials = await getKiwoomCredentialsForReadRequest(request, requestUrl);
            const result = await getWatchlistQuotes(request, groupId, requestUrl, credentials);
            sendJson(response, 200, result);
        } catch (error) {
            sendJson(response, error.statusCode || 500, { message: error.message });
        }
        return;
    }

    if (request.method === 'PUT' && watchlistMatch) {
        try {
            const groupId = decodeURIComponent(watchlistMatch[1]);
            const payload = await parseRequestBody(request);
            const result = await updateWatchlist(request, groupId, payload, requestUrl);
            sendJson(response, 200, result);
        } catch (error) {
            sendJson(response, error.statusCode || 400, { message: error.message });
        }
        return;
    }

    if (request.method === 'DELETE' && watchlistMatch) {
        try {
            const groupId = decodeURIComponent(watchlistMatch[1]);
            const result = await deleteWatchlist(request, groupId, requestUrl);
            sendJson(response, 200, result);
        } catch (error) {
            sendJson(response, error.statusCode || 400, { message: error.message });
        }
        return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/indicator-strategies') {
        try {
            const strategies = await getIndicatorStrategies(request, requestUrl);
            sendJson(response, 200, { strategies });
        } catch (error) {
            sendJson(response, error.statusCode || 500, { message: error.message });
        }
        return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/integration-status') {
        try {
            const status = await getUserIntegrationStatus(request, requestUrl);
            sendJson(response, 200, status);
        } catch (error) {
            sendJson(response, error.statusCode || 500, { message: error.message });
        }
        return;
    }

    if (request.method === 'POST' && requestUrl.pathname === '/api/telegram/test') {
        try {
            const result = await testTelegramConnection(request, requestUrl);
            sendJson(response, 200, result);
        } catch (error) {
            sendJson(response, error.statusCode || 500, { message: error.message });
        }
        return;
    }

    if (request.method === 'POST' && requestUrl.pathname === '/api/telegram/verification/start') {
        try {
            const result = await startTelegramVerification(request, requestUrl);
            sendJson(response, 200, result);
        } catch (error) {
            sendJson(response, error.statusCode || 500, { message: error.message });
        }
        return;
    }

    if (request.method === 'POST' && requestUrl.pathname === '/api/telegram/verification/confirm') {
        try {
            const payload = await parseRequestBody(request);
            const result = await confirmTelegramVerification(request, payload, requestUrl);
            sendJson(response, 200, result);
        } catch (error) {
            sendJson(response, error.statusCode || 500, { message: error.message });
        }
        return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/auto-trade-rules') {
        try {
            const rules = await getAutoTradeRules(request, requestUrl);
            sendJson(response, 200, { rules });
        } catch (error) {
            sendJson(response, error.statusCode || 500, { message: error.message });
        }
        return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/auto-trade-engine/status') {
        sendJson(response, 200, getAutoTradeEngineStatus());
        return;
    }

    if (request.method === 'POST' && requestUrl.pathname === '/api/auto-trade-rules') {
        try {
            const payload = await parseRequestBody(request);
            const rule = await saveAutoTradeRule(request, payload, requestUrl);
            sendJson(response, 200, rule);
        } catch (error) {
            sendJson(response, error.statusCode || 400, { message: error.message });
        }
        return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/account/orderable-cash') {
        try {
            const credentials = await getKiwoomCredentialsForRequest(request, requestUrl);
            const account = await getOrderableCash(credentials);
            sendJson(response, 200, account);
        } catch (error) {
            sendJson(response, error.statusCode || 500, { message: error.message });
        }
        return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/account/portfolio') {
        try {
            const credentials = await getKiwoomCredentialsForRequest(request, requestUrl);
            const portfolio = await getPortfolio(credentials);
            sendJson(response, 200, portfolio);
        } catch (error) {
            sendJson(response, error.statusCode || 500, { message: error.message });
        }
        return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/account/holding') {
        try {
            const stockCode = requestUrl.searchParams.get('code') || '';
            const credentials = await getKiwoomCredentialsForRequest(request, requestUrl);
            const holding = await getStockHolding(stockCode, credentials);
            sendJson(response, 200, holding);
        } catch (error) {
            sendJson(response, error.statusCode || 500, { message: error.message });
        }
        return;
    }

    if (request.method === 'POST' && requestUrl.pathname === '/api/indicator-strategies') {
        try {
            const payload = await parseRequestBody(request);
            const strategy = await createIndicatorStrategy(request, payload, requestUrl);
            sendJson(response, 201, strategy);
        } catch (error) {
            const statusCode = error.message === 'Strategy name already exists.' ? 409 : 400;
            sendJson(response, error.statusCode || statusCode, { message: error.message });
        }
        return;
    }

    if (request.method === 'POST' && requestUrl.pathname === '/api/user-api-credentials') {
        try {
            const payload = await parseRequestBody(request);
            const result = await saveUserApiCredentials(request, payload);
            sendJson(response, 200, result);
        } catch (error) {
            sendJson(response, error.statusCode || 400, { message: error.message });
        }
        return;
    }

    if (request.method === 'POST' && autoTradeRuleStartMatch) {
        try {
            const rule = await updateAutoTradeRuleEnabled(request, autoTradeRuleStartMatch[1], true, requestUrl);
            sendJson(response, 200, rule);
        } catch (error) {
            sendJson(response, error.statusCode || 400, { message: error.message });
        }
        return;
    }

    if (request.method === 'POST' && autoTradeRuleStopMatch) {
        try {
            const rule = await updateAutoTradeRuleEnabled(request, autoTradeRuleStopMatch[1], false, requestUrl);
            sendJson(response, 200, rule);
        } catch (error) {
            sendJson(response, error.statusCode || 400, { message: error.message });
        }
        return;
    }

    if (request.method === 'POST' && requestUrl.pathname === '/api/order') {
        try {
            const payload = await parseRequestBody(request);
            const credentials = await getKiwoomCredentialsForRequest(request, requestUrl);
            const order = await placeStockOrder(payload, credentials);
            sendJson(response, 200, order);
        } catch (error) {
            sendJson(response, error.statusCode || 400, { message: error.message });
        }
        return;
    }

    if (request.method === 'POST' && requestUrl.pathname === '/api/order/modify') {
        try {
            const payload = await parseRequestBody(request);
            const credentials = await getKiwoomCredentialsForRequest(request, requestUrl);
            const order = await modifyStockOrder(payload, credentials);
            sendJson(response, 200, order);
        } catch (error) {
            sendJson(response, error.statusCode || 400, { message: error.message });
        }
        return;
    }

    if (request.method === 'POST' && requestUrl.pathname === '/api/order/cancel') {
        try {
            const payload = await parseRequestBody(request);
            const credentials = await getKiwoomCredentialsForRequest(request, requestUrl);
            const order = await cancelStockOrder(payload, credentials);
            sendJson(response, 200, order);
        } catch (error) {
            sendJson(response, error.statusCode || 400, { message: error.message });
        }
        return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/orders/pending') {
        try {
            const stockCode = requestUrl.searchParams.get('code') || '';
            const credentials = await getKiwoomCredentialsForRequest(request, requestUrl);
            const orders = await getPendingOrders(stockCode, credentials);
            sendJson(response, 200, { orders });
        } catch (error) {
            sendJson(response, error.statusCode || 500, { message: error.message });
        }
        return;
    }

    if (request.method === 'PUT' && strategyMatch) {
        try {
            const payload = await parseRequestBody(request);
            const strategy = await updateIndicatorStrategy(request, strategyMatch[1], payload, requestUrl);
            sendJson(response, 200, strategy);
        } catch (error) {
            const statusCode = error.message === 'Strategy not found.'
                ? 404
                : error.message === 'Strategy name already exists.' ? 409 : 400;
            sendJson(response, error.statusCode || statusCode, { message: error.message });
        }
        return;
    }

    if (request.method === 'DELETE' && strategyMatch) {
        try {
            await deleteIndicatorStrategy(request, strategyMatch[1], requestUrl);
            sendJson(response, 200, { ok: true });
        } catch (error) {
            const statusCode = error.message === 'Strategy not found.' ? 404 : 400;
            sendJson(response, error.statusCode || statusCode, { message: error.message });
        }
        return;
    }

    if (request.method === 'GET' && stockMatch) {
        try {
            const query = decodeURIComponent(stockMatch[1]);
            const credentials = await getKiwoomCredentialsForReadRequest(request, requestUrl);
            const code = await resolveStockCode(query, credentials);
            const stock = await getStockInfo(code, credentials);
            sendJson(response, 200, stock);
        } catch (error) {
            sendJson(response, error.statusCode || 500, { message: error.message });
        }
        return;
    }

    if (request.method === 'GET' && chartMatch) {
        try {
            const query = decodeURIComponent(chartMatch[1]);
            const interval = requestUrl.searchParams.get('interval') || '1';
            const credentials = await getKiwoomCredentialsForReadRequest(request, requestUrl);
            const chart = await getChartData(query, interval, credentials, {
                years: requestUrl.searchParams.get('years'),
                limit: requestUrl.searchParams.get('limit'),
                startDate: requestUrl.searchParams.get('startDate'),
                endDate: requestUrl.searchParams.get('endDate'),
                settled: requestUrl.searchParams.get('settled') === '1',
            });
            sendJson(response, 200, chart);
        } catch (error) {
            sendJson(response, error.statusCode || 500, { message: error.message });
        }
        return;
    }

    if (request.method === 'GET' && strategyChartMatch) {
        try {
            const query = decodeURIComponent(strategyChartMatch[1]);
            const interval = requestUrl.searchParams.get('interval') || '15';
            const credentials = await getKiwoomCredentialsForRequest(request, requestUrl);
            const chart = await getStrategyChartData(query, interval, credentials, {
                years: requestUrl.searchParams.get('years'),
                limit: requestUrl.searchParams.get('limit'),
                startDate: requestUrl.searchParams.get('startDate'),
                endDate: requestUrl.searchParams.get('endDate'),
            });
            sendJson(response, 200, chart);
        } catch (error) {
            sendJson(response, error.statusCode || 500, { message: error.message });
        }
        return;
    }

    if (request.method === 'GET' && realtimeMatch) {
        try {
            const query = decodeURIComponent(realtimeMatch[1]);
            const credentials = await getKiwoomCredentialsForReadRequest(request, requestUrl);
            await subscribeRealtime(request, response, query, credentials);
        } catch (error) {
            sendJson(response, error.statusCode || 500, { message: error.message });
        }
        return;
    }

    if (request.method === 'GET') {
        sendStatic(request, response);
        return;
    }

    response.writeHead(405);
    response.end('Method not allowed');
});

if (require.main === module) {
    server.listen(PORT, () => {
        console.log(`AutoTrading server: http://localhost:${PORT}`);
        startAutoTradeEngine();
    });
}

module.exports = server;
