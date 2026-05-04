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
const { getStockInfo, resolveStockCode, searchStocks } = require('./backend/stocks');
const { subscribeRealtime } = require('./backend/realtime');

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
    const strategyMatch = requestUrl.pathname.match(/^\/api\/indicator-strategies\/(\d+)$/);

    if (request.method === 'GET' && requestUrl.pathname === '/api/search') {
        try {
            const query = requestUrl.searchParams.get('q') || '';
            const results = await searchStocks(query);
            sendJson(response, 200, { results });
        } catch (error) {
            sendJson(response, 500, { message: error.message });
        }
        return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/indicator-strategies') {
        try {
            sendJson(response, 200, { strategies: getIndicatorStrategies() });
        } catch (error) {
            sendJson(response, 500, { message: error.message });
        }
        return;
    }

    if (request.method === 'POST' && requestUrl.pathname === '/api/indicator-strategies') {
        try {
            const payload = await parseRequestBody(request);
            const strategy = createIndicatorStrategy(payload);
            sendJson(response, 201, strategy);
        } catch (error) {
            const statusCode = error.message === 'Strategy name already exists.' ? 409 : 400;
            sendJson(response, statusCode, { message: error.message });
        }
        return;
    }

    if (request.method === 'PUT' && strategyMatch) {
        try {
            const payload = await parseRequestBody(request);
            const strategy = updateIndicatorStrategy(strategyMatch[1], payload);
            sendJson(response, 200, strategy);
        } catch (error) {
            const statusCode = error.message === 'Strategy not found.'
                ? 404
                : error.message === 'Strategy name already exists.' ? 409 : 400;
            sendJson(response, statusCode, { message: error.message });
        }
        return;
    }

    if (request.method === 'DELETE' && strategyMatch) {
        try {
            deleteIndicatorStrategy(strategyMatch[1]);
            sendJson(response, 200, { ok: true });
        } catch (error) {
            const statusCode = error.message === 'Strategy not found.' ? 404 : 400;
            sendJson(response, statusCode, { message: error.message });
        }
        return;
    }

    if (request.method === 'GET' && stockMatch) {
        try {
            const query = decodeURIComponent(stockMatch[1]);
            const code = await resolveStockCode(query);
            const stock = await getStockInfo(code);
            sendJson(response, 200, stock);
        } catch (error) {
            sendJson(response, 500, { message: error.message });
        }
        return;
    }

    if (request.method === 'GET' && chartMatch) {
        try {
            const query = decodeURIComponent(chartMatch[1]);
            const interval = requestUrl.searchParams.get('interval') || '1';
            const chart = await getChartData(query, interval);
            sendJson(response, 200, chart);
        } catch (error) {
            sendJson(response, 500, { message: error.message });
        }
        return;
    }

    if (request.method === 'GET' && realtimeMatch) {
        const query = decodeURIComponent(realtimeMatch[1]);
        await subscribeRealtime(request, response, query);
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
