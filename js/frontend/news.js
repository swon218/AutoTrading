import { authFetch } from './apiClient.js';

document.addEventListener('DOMContentLoaded', () => {
    const sidebarToggle = document.getElementById('sidebarToggle');
    const appSidebar = document.getElementById('appSidebar');
    const searchBar = document.getElementById('searchBar');
    const searchClearButton = document.getElementById('searchClearButton');
    const searchModal = document.getElementById('searchModal');
    const searchResults = document.getElementById('searchResults');
    const newsRefreshButton = document.getElementById('newsRefreshButton');
    const newsTabs = Array.from(document.querySelectorAll('.news-filter-tab'));
    const newsList = document.querySelector('.news-list');
    const newsSummaryList = document.querySelector('.news-summary-list');
    const newsPanelStatus = document.querySelector('.news-panel .news-panel-head span');
    const newsSummaryStatus = document.querySelector('.news-watch-panel .news-panel-head span');
    const newsSearchForm = document.getElementById('newsSearchForm');
    const newsSearchInput = document.getElementById('newsSearchInput');
    const newsSearchClearButton = document.getElementById('newsSearchClearButton');

    let searchTimer = null;
    let currentNewsFilter = 0;
    let currentNewsPage = 1;
    let currentNewsSearchTerm = '';
    const NEWS_ITEMS_PER_PAGE = 15;
    const NEWS_PAGE_COUNT = 5;

    const NEWS_FILTERS = [
        { label: '\uC804\uCCB4', query: '\uACBD\uC81C \uC99D\uC2DC' },
        { label: '\uC2DC\uC7A5', query: '\uAD6D\uB0B4 \uC99D\uC2DC \uCF54\uC2A4\uD53C \uCF54\uC2A4\uB2E5' },
        { label: '\uC885\uBAA9', query: '\uC0C1\uC7A5\uC0AC \uAE30\uC5C5 \uC2E4\uC801' },
        { label: '\uACF5\uC2DC', query: '\uACF5\uC2DC \uD22C\uC790' },
    ];

    const newsPageTabs = document.createElement('div');
    newsPageTabs.className = 'news-page-tabs';
    newsPageTabs.setAttribute('role', 'tablist');
    newsPageTabs.setAttribute('aria-label', '\uB274\uC2A4 \uD398\uC774\uC9C0');

    const escapeHtml = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const renderSearchMessage = (message) => {
        if (!searchResults) return;
        searchResults.innerHTML = `<div class="search-empty">${escapeHtml(message)}</div>`;
    };

    const formatNewsTime = (value) => {
        if (!value) return '-';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '-';
        return new Intl.DateTimeFormat('ko-KR', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        }).format(date);
    };

    const setNewsPending = (isPending) => {
        newsRefreshButton?.classList.toggle('is-loading', isPending);
        if (newsRefreshButton) newsRefreshButton.disabled = isPending;
    };

    const setNewsMessage = (message) => {
        if (!newsList) return;
        newsList.innerHTML = `
            <article class="news-item">
                <div class="news-item-meta">
                    <span>\uB274\uC2A4</span>
                    <time>-</time>
                </div>
                <h3>${escapeHtml(message)}</h3>
            </article>
        `;
    };

    const renderNewsSummary = ({ filter, count, total, updatedAt }) => {
        if (newsPanelStatus) newsPanelStatus.textContent = updatedAt ? formatNewsTime(updatedAt) : '\uC5F0\uACB0 \uC644\uB8CC';
        if (newsSummaryStatus) newsSummaryStatus.textContent = '\uC624\uB298';
        if (!newsSummaryList) return;
        const activeLabel = currentNewsSearchTerm
            ? `\uAC80\uC0C9: ${currentNewsSearchTerm}`
            : filter.label;

        newsSummaryList.innerHTML = `
            <div>
                <span>${currentNewsSearchTerm ? '\uD604\uC7AC \uAC80\uC0C9\uC5B4' : '\uD604\uC7AC \uD544\uD130'}</span>
                <strong>${escapeHtml(activeLabel)} ${escapeHtml(currentNewsPage)}\uD398\uC774\uC9C0</strong>
            </div>
            <div>
                <span>\uD45C\uC2DC \uAE30\uC0AC</span>
                <strong>${escapeHtml(count)}\uAC74</strong>
            </div>
            <div>
                <span>\uB124\uC774\uBC84 \uAC80\uC0C9 \uACB0\uACFC</span>
                <strong>${escapeHtml(total)}\uAC74</strong>
            </div>
        `;
    };

    const renderNewsPageTabs = () => {
        newsPageTabs.innerHTML = Array.from({ length: NEWS_PAGE_COUNT }, (_, index) => {
            const page = index + 1;
            const isActive = page === currentNewsPage;
            return `
                <button class="news-page-tab${isActive ? ' is-active' : ''}" type="button" data-news-page="${page}" aria-selected="${String(isActive)}">
                    ${page}
                </button>
            `;
        }).join('');
    };

    const renderNewsItems = (items = []) => {
        if (!newsList) return;
        if (!items.length) {
            setNewsMessage('\uD45C\uC2DC\uD560 \uACBD\uC81C \uB274\uC2A4\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.');
            return;
        }

        newsList.innerHTML = items.map((item) => `
            <a class="news-item" href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">
                <div class="news-item-meta">
                    <span>${escapeHtml(item.source || 'Naver News')}</span>
                    <time>${escapeHtml(formatNewsTime(item.publishedAt))}</time>
                </div>
                <h3>${escapeHtml(item.title)}</h3>
                <p>${escapeHtml(item.description)}</p>
            </a>
        `).join('');
    };

    const loadNews = async () => {
        const filter = NEWS_FILTERS[currentNewsFilter] || NEWS_FILTERS[0];
        const query = currentNewsSearchTerm || filter.query;
        setNewsPending(true);
        setNewsMessage(currentNewsSearchTerm
            ? `'${currentNewsSearchTerm}' \uB274\uC2A4\uB97C \uBD88\uB7EC\uC624\uB294 \uC911...`
            : '\uB124\uC774\uBC84 \uACBD\uC81C \uB274\uC2A4\uB97C \uBD88\uB7EC\uC624\uB294 \uC911...');
        if (newsPanelStatus) newsPanelStatus.textContent = '\uC870\uD68C \uC911...';

        try {
            const params = new URLSearchParams({
                q: query,
                display: String(NEWS_ITEMS_PER_PAGE),
                start: String((currentNewsPage - 1) * NEWS_ITEMS_PER_PAGE + 1),
            });
            const response = await authFetch(`/api/news?${params.toString()}`, { cache: 'no-store' });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);

            renderNewsItems(payload.items || []);
            if (newsList) newsList.scrollTop = 0;
            renderNewsSummary({
                filter,
                count: (payload.items || []).length,
                total: payload.total || 0,
                updatedAt: new Date().toISOString(),
            });
        } catch (error) {
            console.error('News request failed.', error);
            setNewsMessage(error.message || '\uB274\uC2A4\uB97C \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.');
            renderNewsSummary({
                filter,
                count: 0,
                total: 0,
                updatedAt: '',
            });
            if (newsPanelStatus) newsPanelStatus.textContent = '\uC870\uD68C \uC2E4\uD328';
        } finally {
            setNewsPending(false);
        }
    };

    const initNewsShellText = () => {
        const title = document.querySelector('.news-toolbar h1');
        const description = document.querySelector('.news-toolbar p');
        const panelTitle = document.querySelector('.news-panel .news-panel-head h2');
        const summaryTitle = document.querySelector('.news-watch-panel .news-panel-head h2');

        if (title) title.textContent = '\uB274\uC2A4';
        if (description) description.textContent = '\uB124\uC774\uBC84 \uACBD\uC81C \uB274\uC2A4\uB97C \uC2E4\uC2DC\uAC04\uC73C\uB85C \uD655\uC778\uD569\uB2C8\uB2E4.';
        if (panelTitle) panelTitle.textContent = '\uC8FC\uC694 \uACBD\uC81C \uB274\uC2A4';
        if (summaryTitle) summaryTitle.textContent = '\uC694\uC57D';
        newsRefreshButton?.setAttribute('title', '\uC0C8\uB85C\uACE0\uCE68');
        newsRefreshButton?.setAttribute('aria-label', '\uB274\uC2A4 \uC0C8\uB85C\uACE0\uCE68');
        if (newsSearchInput) newsSearchInput.placeholder = '\uB274\uC2A4 \uD0A4\uC6CC\uB4DC \uAC80\uC0C9';
        newsSearchClearButton?.setAttribute('title', '\uAC80\uC0C9\uC5B4 \uC9C0\uC6B0\uAE30');
        newsSearchClearButton?.setAttribute('aria-label', '\uAC80\uC0C9\uC5B4 \uC9C0\uC6B0\uAE30');
        newsTabs.forEach((button, index) => {
            const filter = NEWS_FILTERS[index] || NEWS_FILTERS[0];
            button.textContent = filter.label;
            button.setAttribute('role', 'tab');
            button.setAttribute('aria-selected', String(index === currentNewsFilter));
        });
        renderNewsPageTabs();
        newsList?.insertAdjacentElement('afterend', newsPageTabs);
    };

    const renderSearchResults = (results = []) => {
        if (!searchResults) return;
        if (!results.length) {
            renderSearchMessage('검색 결과가 없습니다.');
            return;
        }
        searchResults.innerHTML = results.map((stock) => `
            <button class="search-result-item" type="button" data-code="${escapeHtml(stock.code)}">
                <span class="search-result-name">${escapeHtml(stock.name)}</span>
                <span class="search-result-code">${escapeHtml(stock.code)}</span>
            </button>
        `).join('');
    };

    const searchStocks = async (query) => {
        const keyword = String(query || '').trim();
        if (!keyword) {
            renderSearchMessage('종목명 또는 종목코드를 입력하세요.');
            return;
        }

        renderSearchMessage('검색 중...');
        try {
            const response = await authFetch(`/api/search?q=${encodeURIComponent(keyword)}`, { cache: 'no-store' });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
            renderSearchResults(payload.results || []);
        } catch (error) {
            console.error('News search failed.', error);
            renderSearchMessage(error.message || '검색하지 못했습니다.');
        }
    };

    const openTradingPage = (code) => {
        const target = String(code || '').trim();
        if (!target) return;
        window.location.href = `trading.html?code=${encodeURIComponent(target)}`;
    };

    const updateSearchClearButton = () => {
        searchClearButton?.classList.toggle('show', Boolean(searchBar?.value));
    };

    const updateNewsSearchClearButton = () => {
        newsSearchClearButton?.classList.toggle('hidden', !newsSearchInput?.value);
    };

    sidebarToggle?.addEventListener('click', () => {
        const isCollapsed = appSidebar?.classList.toggle('is-collapsed');
        sidebarToggle.setAttribute('aria-expanded', String(!isCollapsed));
        sidebarToggle.setAttribute('aria-label', isCollapsed ? '좌측 메뉴 펼치기' : '좌측 메뉴 접기');
    });

    searchBar?.addEventListener('input', () => {
        updateSearchClearButton();
        searchModal?.classList.add('show');
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(() => searchStocks(searchBar.value), 250);
    });

    searchBar?.addEventListener('focus', () => {
        searchModal?.classList.add('show');
    });

    searchBar?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        const firstResult = searchResults?.querySelector('.search-result-item');
        if (firstResult) {
            openTradingPage(firstResult.dataset.code);
            return;
        }
        openTradingPage(searchBar.value);
    });

    searchClearButton?.addEventListener('click', () => {
        if (searchBar) searchBar.value = '';
        updateSearchClearButton();
        renderSearchMessage('종목명 또는 종목코드를 입력하세요.');
    });

    searchResults?.addEventListener('click', (event) => {
        const item = event.target.closest('.search-result-item');
        if (!item) return;
        openTradingPage(item.dataset.code);
    });

    newsTabs.forEach((button, index) => {
        button.addEventListener('click', () => {
            currentNewsFilter = index;
            currentNewsPage = 1;
            currentNewsSearchTerm = '';
            if (newsSearchInput) newsSearchInput.value = '';
            updateNewsSearchClearButton();
            newsTabs.forEach((tab, tabIndex) => {
                const isActive = tabIndex === currentNewsFilter;
                tab.classList.toggle('is-active', isActive);
                tab.setAttribute('aria-selected', String(isActive));
            });
            renderNewsPageTabs();
            loadNews();
        });
    });

    newsPageTabs.addEventListener('click', (event) => {
        const button = event.target.closest('[data-news-page]');
        if (!button) return;
        const page = Number.parseInt(button.dataset.newsPage, 10);
        if (!page || page === currentNewsPage) return;
        currentNewsPage = page;
        renderNewsPageTabs();
        loadNews();
    });

    newsSearchForm?.addEventListener('submit', (event) => {
        event.preventDefault();
        const keyword = String(newsSearchInput?.value || '').trim();
        currentNewsSearchTerm = keyword;
        currentNewsPage = 1;
        renderNewsPageTabs();
        updateNewsSearchClearButton();
        loadNews();
    });

    newsSearchInput?.addEventListener('input', updateNewsSearchClearButton);

    newsSearchClearButton?.addEventListener('click', () => {
        if (newsSearchInput) newsSearchInput.value = '';
        currentNewsSearchTerm = '';
        updateNewsSearchClearButton();
        newsSearchInput?.focus();
    });

    newsRefreshButton?.addEventListener('click', loadNews);

    document.addEventListener('click', (event) => {
        if (!searchModal || !searchBar) return;
        if (!searchModal.contains(event.target) && event.target !== searchBar) {
            searchModal.classList.remove('show');
        }
    });

    initNewsShellText();
    updateNewsSearchClearButton();
    loadNews();
});
