const { loadDotEnv } = require('./env');

const NAVER_NEWS_ENDPOINT = 'https://openapi.naver.com/v1/search/news.json';
const DEFAULT_DISPLAY = 15;
const MAX_DISPLAY = 30;
const MAX_START = 1000;

function getNaverCredentials() {
    loadDotEnv();

    const clientId = process.env.NAVER_CLIENT_ID || process.env.client_id || '';
    const clientSecret = process.env.NAVER_CLIENT_SECRET || process.env.client_secret || '';

    if (!clientId || !clientSecret) {
        const error = new Error('NAVER news API client_id/client_secret is missing in .env.');
        error.statusCode = 503;
        throw error;
    }

    return { clientId, clientSecret };
}

function decodeHtmlEntities(value = '') {
    return String(value)
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}

function normalizeNewsText(value = '') {
    return decodeHtmlEntities(value)
        .replace(/<\/?b>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeNewsItem(item = {}) {
    const publishedAt = item.pubDate ? new Date(item.pubDate) : null;

    return {
        title: normalizeNewsText(item.title),
        description: normalizeNewsText(item.description),
        link: item.originallink || item.link || '',
        naverLink: item.link || '',
        publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime())
            ? publishedAt.toISOString()
            : '',
        source: 'Naver News',
    };
}

async function getEconomicNews(options = {}) {
    const { clientId, clientSecret } = getNaverCredentials();
    const query = String(options.query || '\uACBD\uC81C').trim() || '\uACBD\uC81C';
    const display = Math.min(
        MAX_DISPLAY,
        Math.max(1, Number.parseInt(options.display, 10) || DEFAULT_DISPLAY),
    );
    const start = Math.min(
        MAX_START,
        Math.max(1, Number.parseInt(options.start, 10) || 1),
    );

    const params = new URLSearchParams({
        query,
        display: String(display),
        start: String(start),
        sort: 'date',
    });

    const response = await fetch(`${NAVER_NEWS_ENDPOINT}?${params.toString()}`, {
        headers: {
            'X-Naver-Client-Id': clientId,
            'X-Naver-Client-Secret': clientSecret,
        },
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(payload.errorMessage || payload.message || 'Naver news API request failed.');
        error.statusCode = response.status;
        throw error;
    }

    return {
        query,
        start,
        display,
        total: Number(payload.total) || 0,
        lastBuildDate: payload.lastBuildDate || '',
        items: Array.isArray(payload.items)
            ? payload.items.map(normalizeNewsItem).filter((item) => item.title && item.link)
            : [],
    };
}

module.exports = {
    getEconomicNews,
};
