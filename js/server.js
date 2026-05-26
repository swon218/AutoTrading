// 서버 시작, 라우팅, 정적 파일 제공

const http = require('http');
const fs = require('fs');
const path = require('path');
const { ROOT_DIR } = require('./backend/config');
const { getChartData } = require('./backend/charts');
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
const { getKiwoomCredentialsForRequest, saveUserApiCredentials } = require('./backend/userCredentials');

const PORT = Number(process.env.PORT || 3000);

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
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);
    const pathname = decodeURIComponent(requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname);
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
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);
    const stockMatch = requestUrl.pathname.match(/^\/api\/stock\/(.+)$/);
    const chartMatch = requestUrl.pathname.match(/^\/api\/chart\/(.+)$/);
    const realtimeMatch = requestUrl.pathname.match(/^\/api\/realtime\/(.+)$/);
    const strategyMatch = requestUrl.pathname.match(/^\/api\/indicator-strategies\/([^/]+)$/);

    if (request.method === 'GET' && requestUrl.pathname === '/api/health') {
        sendJson(response, 200, { ok: true });
        return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/search') {
        try {
            const query = requestUrl.searchParams.get('q') || '';
            const credentials = await getKiwoomCredentialsForRequest(request, requestUrl);
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
            const credentials = await getKiwoomCredentialsForRequest(request, requestUrl);
            const ranking = await getHomeRanking(type, limit, credentials);
            sendJson(response, 200, ranking);
        } catch (error) {
            sendJson(response, error.statusCode || 500, { message: error.message });
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
            const credentials = await getKiwoomCredentialsForRequest(request, requestUrl);
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
            const credentials = await getKiwoomCredentialsForRequest(request, requestUrl);
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

    if (request.method === 'GET' && realtimeMatch) {
        try {
            const query = decodeURIComponent(realtimeMatch[1]);
            const credentials = await getKiwoomCredentialsForRequest(request, requestUrl);
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
    });
}

module.exports = server;
