import { authFetch } from './apiClient.js';

document.addEventListener('DOMContentLoaded', () => {
    const sidebarToggle = document.getElementById('sidebarToggle');
    const appSidebar = document.getElementById('appSidebar');
    const searchBar = document.getElementById('searchBar');
    const searchClearButton = document.getElementById('searchClearButton');
    const searchModal = document.getElementById('searchModal');
    const searchResults = document.getElementById('searchResults');

    let searchTimer = null;

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

    document.addEventListener('click', (event) => {
        if (!searchModal || !searchBar) return;
        if (!searchModal.contains(event.target) && event.target !== searchBar) {
            searchModal.classList.remove('show');
        }
    });
});
