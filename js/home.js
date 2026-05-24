import { authFetch } from './apiClient.js';

document.addEventListener('DOMContentLoaded', () => {
    const sidebarToggle = document.getElementById('sidebarToggle');
    const appSidebar = document.getElementById('appSidebar');
    const profileBtn = document.getElementById('profileBtn');
    const profileMenu = document.getElementById('profileMenu');
    const searchBar = document.getElementById('searchBar');
    const searchClearButton = document.getElementById('searchClearButton');
    const searchModal = document.getElementById('searchModal');
    const searchResults = document.getElementById('searchResults');
    const rankingTabs = Array.from(document.querySelectorAll('[data-ranking-type]'));
    const rankingTitle = document.getElementById('homeRankingTitle');
    const rankingSubtitle = document.getElementById('homeRankingSubtitle');
    const rankingColumns = document.getElementById('homeRankingColumns');
    const rankingStatus = document.getElementById('homeRankingStatus');
    const rankingList = document.getElementById('homeRankingList');
    const rankingRefresh = document.getElementById('homeRankingRefresh');

    let searchTimer = null;
    let latestResults = [];
    let activeSearchIndex = -1;
    let activeRankingType = rankingTabs[0]?.dataset.rankingType || 'realtime';
    let rankingAbortController = null;

    const rankingTypeMeta = {
        realtime: { label: '실시간조회', apiId: 'ka00198' },
        movers: { label: '상승률/하락률', apiId: 'ka10027' },
        volume: { label: '거래량 상위', apiId: 'ka10030' },
        volumeSpike: { label: '거래량 급증', apiId: 'ka10023' },
        domesticTradeTop: { label: '개인/기관 매매상위', apiId: 'ka10065' },
        foreignInstitutionTop: { label: '외국인/기관 매매상위', apiId: 'ka90009' },
        sector: { label: '섹터상위', apiId: 'ka20003' },
    };

    const renderSearchMessage = (message) => {
        if (!searchResults) return;
        activeSearchIndex = -1;
        searchResults.replaceChildren();
        const empty = document.createElement('div');
        empty.className = 'search-empty';
        empty.textContent = message;
        searchResults.appendChild(empty);
    };

    const escapeHtml = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const renderSearchResults = (results) => {
        if (!searchResults) return;

        const previousResults = latestResults;
        const previousActiveIndex = activeSearchIndex;
        const isSameResultSet = previousResults.length === results.length
            && previousResults.every((stock, index) => stock.code === results[index]?.code);

        latestResults = results;
        activeSearchIndex = results.length
            ? (isSameResultSet && previousActiveIndex >= 0 ? Math.min(previousActiveIndex, results.length - 1) : 0)
            : -1;

        if (!results.length) {
            renderSearchMessage('검색 결과가 없습니다.');
            return;
        }

        searchResults.innerHTML = results
            .map((stock, index) => {
                const activeClass = index === activeSearchIndex ? ' is-active' : '';
                return `
                    <button class="search-result-item${activeClass}" type="button" data-code="${escapeHtml(stock.code)}" data-index="${index}">
                        <span class="search-result-name">${escapeHtml(stock.name)}</span>
                        <span class="search-result-code">${escapeHtml(stock.code)}</span>
                    </button>
                `;
            })
            .join('');
    };

    const updateActiveSearchResult = () => {
        if (!searchResults) return;
        const items = Array.from(searchResults.querySelectorAll('.search-result-item'));
        items.forEach((item, index) => {
            item.classList.toggle('is-active', index === activeSearchIndex);
            if (index === activeSearchIndex) {
                item.scrollIntoView({ block: 'nearest' });
            }
        });
    };

    const hydrateSearchResultsFromDom = () => {
        if (!searchResults) return false;

        const items = Array.from(searchResults.querySelectorAll('.search-result-item'));
        if (!items.length) return false;

        latestResults = items.map((item) => ({
            code: item.dataset.code || '',
            name: item.querySelector('.search-result-name')?.textContent?.trim() || '',
        })).filter((stock) => stock.code);

        if (!latestResults.length) return false;

        const activeItemIndex = items.findIndex((item) => item.classList.contains('is-active'));
        activeSearchIndex = activeItemIndex >= 0 ? activeItemIndex : 0;
        return true;
    };

    const moveActiveSearchResult = (direction) => {
        if (!latestResults.length && !hydrateSearchResultsFromDom()) return;
        activeSearchIndex = (activeSearchIndex + direction + latestResults.length) % latestResults.length;
        updateActiveSearchResult();
    };

    const searchStocks = async (query) => {
        const keyword = String(query || '').trim();
        latestResults = [];
        activeSearchIndex = -1;

        if (!keyword) {
            renderSearchMessage('종목명 또는 종목코드를 입력하세요.');
            return;
        }

        if (/^\d{6}$/.test(keyword)) {
            renderSearchResults([{ code: keyword, name: '종목코드 직접 조회' }]);
            return;
        }

        try {
            renderSearchMessage('검색 중...');
            const response = await authFetch(`/api/search?q=${encodeURIComponent(keyword)}`, {
                cache: 'no-store',
            });

            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw new Error(payload.message || `HTTP ${response.status}`);
            }

            const payload = await response.json();
            renderSearchResults(payload.results || []);
        } catch (error) {
            console.error('Search request failed.', error);
            renderSearchMessage('검색 중 오류가 발생했습니다.');
        }
    };

    const updateSearchClearButton = () => {
        if (!searchClearButton || !searchBar) return;
        searchClearButton.classList.toggle('show', Boolean(searchBar.value));
    };

    const formatNumber = (value) => {
        if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
        return Number(value).toLocaleString('ko-KR');
    };

    const setRankingStatus = (message = '', show = Boolean(message)) => {
        if (!rankingStatus) return;
        rankingStatus.textContent = message;
        rankingStatus.classList.toggle('show', show);
    };

    const setActiveRankingTab = (type) => {
        activeRankingType = type;
        rankingTabs.forEach((tab) => {
            tab.classList.toggle('is-active', tab.dataset.rankingType === type);
        });
    };

    const renderRankingRow = (item, index, metricLabel = '') => {
        const directionClass = item.direction === 'up' ? ' is-up' : item.direction === 'down' ? ' is-down' : '';
        const code = escapeHtml(item.code || '');
        const target = escapeHtml(item.code || item.name || '');
        const priceText = item.price ? `${formatNumber(item.price)}원` : item.metric || '-';
        const volumeText = item.volume ? formatNumber(item.volume) : '-';
        const volumeCell = activeRankingType === 'realtime'
            ? ''
            : `<span class="home-ranking-volume">${escapeHtml(volumeText)}</span>`;
        const hasChangeRate = item.changeRate !== null && item.changeRate !== undefined && !Number.isNaN(Number(item.changeRate));
        const fallbackMetricLabel = activeRankingType === 'realtime' ? '' : metricLabel;
        const metricText = hasChangeRate
            ? `${Number(item.changeRate).toFixed(2)}%`
            : item.metric ? `${fallbackMetricLabel} ${escapeHtml(item.metric)}`.trim() : fallbackMetricLabel;

        return `
            <button class="home-ranking-card${directionClass}" type="button" data-target="${target}">
                <span class="home-ranking-rank">${escapeHtml(item.rank || index + 1)}</span>
                <span class="home-ranking-name">
                    <strong>${escapeHtml(item.name)}</strong>
                    <span>${code || '업종/섹터'}</span>
                </span>
                <span class="home-ranking-price">${escapeHtml(priceText)}</span>
                <span class="home-ranking-rate">
                    ${escapeHtml(metricText || '-')}
                </span>
                ${volumeCell}
                <span class="home-ranking-refresh-space" aria-hidden="true"></span>
            </button>
        `;
    };

    const renderMoverRankingItems = (items = [], metricLabel = '', groups = {}) => {
        const gainers = groups.gainers || items.slice(0, 20);
        const losers = groups.losers || items.slice(20);

        rankingList.classList.add('is-mover-layout');
        rankingList.classList.remove('is-card-layout', 'is-row-layout');
        rankingList.innerHTML = `
            <section class="home-mover-column" aria-label="상승률 상위">
                <div class="home-mover-column-head">
                    <h2>상승률</h2>
                    <div class="home-mover-column-labels" aria-hidden="true">
                        <span>현재가</span>
                        <span>등락률</span>
                        <span>거래량</span>
                    </div>
                </div>
                <div class="home-mover-list">
                    ${gainers.map((item, index) => renderRankingRow(item, index, metricLabel)).join('') || '<div class="home-ranking-empty">표시할 상승 종목이 없습니다.</div>'}
                </div>
            </section>
            <section class="home-mover-column" aria-label="하락률 상위">
                <div class="home-mover-column-head">
                    <h2>하락률</h2>
                    <div class="home-mover-column-labels" aria-hidden="true">
                        <span>현재가</span>
                        <span>등락률</span>
                        <span>거래량</span>
                    </div>
                </div>
                <div class="home-mover-list">
                    ${losers.map((item, index) => renderRankingRow(item, index, metricLabel)).join('') || '<div class="home-ranking-empty">표시할 하락 종목이 없습니다.</div>'}
                </div>
            </section>
        `;
    };

    const renderRankingItems = (items = [], metricLabel = '', groups = {}) => {
        if (!rankingList) return;
        if (!items.length) {
            rankingList.replaceChildren();
            rankingList.classList.remove('is-card-layout', 'is-row-layout', 'is-mover-layout', 'is-realtime-layout');
            setRankingStatus('표시할 종목이 없습니다.', true);
            return;
        }

        setRankingStatus('', false);
        if (activeRankingType === 'movers') {
            rankingList.classList.remove('is-realtime-layout');
            renderMoverRankingItems(items, metricLabel, groups);
            return;
        }

        rankingList.classList.remove('is-card-layout', 'is-mover-layout');
        rankingList.classList.add('is-row-layout');
        rankingList.classList.toggle('is-realtime-layout', activeRankingType === 'realtime');
        rankingList.innerHTML = items.map((item, index) => renderRankingRow(item, index, metricLabel)).join('');
    };

    const loadRanking = async (type = activeRankingType) => {
        if (!rankingList) return;
        const meta = rankingTypeMeta[type] || rankingTypeMeta.realtime;

        setActiveRankingTab(type);
        if (rankingTitle) rankingTitle.textContent = meta.label;
        if (rankingSubtitle) rankingSubtitle.textContent = `키움 REST API ${meta.apiId} 기준 상위 목록`;
        rankingColumns?.classList.toggle('is-realtime', type === 'realtime');
        rankingColumns?.classList.toggle('is-mover', type === 'movers');
        rankingList.replaceChildren();
        setRankingStatus('랭킹을 불러오는 중...', true);

        if (rankingAbortController) {
            rankingAbortController.abort();
        }
        rankingAbortController = new AbortController();

        try {
            const response = await authFetch(`/api/home-rankings?type=${encodeURIComponent(type)}&limit=20`, {
                cache: 'no-store',
                signal: rankingAbortController.signal,
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);

            if (rankingSubtitle) {
                rankingSubtitle.textContent = `키움 REST API ${payload.apiId || meta.apiId} 기준 상위 목록`;
            }
            renderRankingItems(payload.items || [], payload.metricLabel || '', payload.groups || {});
        } catch (error) {
            if (error.name === 'AbortError') return;
            console.error('Home ranking request failed.', error);
            rankingList.replaceChildren();
            setRankingStatus(error.message || '랭킹을 불러오지 못했습니다.', true);
        }
    };

    const openTradingPage = (query) => {
        const target = String(query || '').replace(/_.+$/, '').trim();
        if (!target) {
            renderSearchMessage('종목명 또는 종목코드를 입력하세요.');
            return;
        }

        window.location.href = `trading.html?code=${encodeURIComponent(target)}`;
    };

    const moveActiveSearchResultFromInput = (direction) => {
        if (latestResults.length || hydrateSearchResultsFromDom()) {
            moveActiveSearchResult(direction);
            return;
        }

        const keyword = searchBar?.value.trim();
        if (!keyword) return;

        searchStocks(keyword).then(() => {
            moveActiveSearchResult(direction);
        });
    };

    if (profileBtn && profileMenu) {
        profileBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            profileMenu.classList.toggle('hidden');
        });

        document.addEventListener('click', (event) => {
            if (!profileMenu.classList.contains('hidden') && !profileMenu.contains(event.target)) {
                profileMenu.classList.add('hidden');
            }
        });
    }

    if (sidebarToggle && appSidebar) {
        sidebarToggle.addEventListener('click', () => {
            const isCompact = window.matchMedia('(max-width: 1100px)').matches;

            if (isCompact) {
                document.body.classList.toggle('compact-sidebar-open');
                sidebarToggle.setAttribute('aria-expanded', String(document.body.classList.contains('compact-sidebar-open')));
                return;
            }

            appSidebar.classList.toggle('is-collapsed');
            sidebarToggle.setAttribute('aria-expanded', String(!appSidebar.classList.contains('is-collapsed')));
        });
    }

    if (searchBar && searchModal && searchResults) {
        updateSearchClearButton();

        searchBar.addEventListener('focus', () => {
            searchModal.classList.add('show');
            const keyword = searchBar.value.trim();
            if (keyword) {
                searchStocks(keyword);
            } else {
                latestResults = [];
                renderSearchMessage('종목명 또는 종목코드를 입력하세요.');
            }
        });

        searchBar.addEventListener('input', () => {
            searchModal.classList.add('show');
            latestResults = [];
            activeSearchIndex = -1;
            updateSearchClearButton();
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => searchStocks(searchBar.value), 250);
        });

        searchClearButton?.addEventListener('mousedown', (event) => {
            event.preventDefault();
        });

        searchClearButton?.addEventListener('click', (event) => {
            event.stopPropagation();
            clearTimeout(searchTimer);
            searchBar.value = '';
            latestResults = [];
            activeSearchIndex = -1;
            updateSearchClearButton();
            renderSearchMessage('종목명 또는 종목코드를 입력하세요.');
            searchModal.classList.add('show');
            searchBar.focus();
        });

        searchBar.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                clearTimeout(searchTimer);
                searchModal.classList.add('show');
                moveActiveSearchResultFromInput(1);
                return;
            }

            if (event.key === 'ArrowUp') {
                event.preventDefault();
                clearTimeout(searchTimer);
                searchModal.classList.add('show');
                moveActiveSearchResultFromInput(-1);
                return;
            }

            if (event.key !== 'Enter') return;

            event.preventDefault();
            clearTimeout(searchTimer);
            const keyword = searchBar.value.trim();
            const selected = activeSearchIndex >= 0 ? latestResults[activeSearchIndex] : latestResults[0];
            openTradingPage(selected?.code || keyword);
        });

        searchResults.addEventListener('click', (event) => {
            const button = event.target.closest('[data-code]');
            if (!button) return;

            activeSearchIndex = Number(button.dataset.index || -1);
            openTradingPage(button.dataset.code);
        });

        document.addEventListener('click', (event) => {
            if (!searchModal.contains(event.target) && event.target !== searchBar) {
                searchModal.classList.remove('show');
            }
        });
    }

    rankingTabs.forEach((tab) => {
        tab.addEventListener('click', () => {
            loadRanking(tab.dataset.rankingType || 'realtime');
        });
    });

    rankingRefresh?.addEventListener('click', () => {
        loadRanking(activeRankingType);
    });

    rankingList?.addEventListener('click', (event) => {
        const card = event.target.closest('.home-ranking-card');
        if (!card) return;
        openTradingPage(card.dataset.target);
    });

    loadRanking(activeRankingType);
});
