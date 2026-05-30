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
    const watchlistGroupTabs = document.getElementById('watchlistGroupTabs');
    const watchlistManageButton = document.getElementById('watchlistManageButton');
    const watchlistModal = document.getElementById('watchlistGroupModal');
    const watchlistModalClose = document.getElementById('watchlistGroupModalClose');
    const watchlistListPane = document.getElementById('watchlistListPane');
    const watchlistEditPane = document.getElementById('watchlistEditPane');
    const watchlistGroupName = document.getElementById('watchlistGroupName');
    const watchlistGroupAddBtn = document.getElementById('watchlistGroupAddBtn');
    const watchlistGroupList = document.getElementById('watchlistGroupList');
    const watchlistEditBack = document.getElementById('watchlistEditBack');
    const watchlistEditName = document.getElementById('watchlistEditName');
    const watchlistSourceType = document.getElementById('watchlistSourceType');
    const watchlistSourceLoad = document.getElementById('watchlistSourceLoad');
    const watchlistStockSearch = document.getElementById('watchlistStockSearch');
    const watchlistStockResults = document.getElementById('watchlistStockResults');
    const watchlistSelectedList = document.getElementById('watchlistSelectedList');
    const watchlistSaveButton = document.getElementById('watchlistSaveButton');
    const watchlistDeleteButton = document.getElementById('watchlistDeleteButton');
    const watchlistResetButton = document.getElementById('watchlistResetButton');

    let searchTimer = null;
    let latestResults = [];
    let activeSearchIndex = -1;
    let activeRankingType = rankingTabs[0]?.dataset.rankingType || 'realtime';
    let activeWatchlistId = '';
    let rankingAbortController = null;
    let watchlistGroups = [];
    let editingGroup = null;
    let editingItems = [];
    let watchlistSearchTimer = null;
    let draggingWatchlistCode = '';
    let latestWatchlistSearchResults = [];
    let activeWatchlistSearchIndex = -1;

    const rankingTypeMeta = {
        realtime: { label: '실시간조회', apiId: 'ka00198' },
        movers: { label: '상승률/하락률', apiId: 'ka10027' },
        gainers: { label: '상승률', apiId: 'ka10027' },
        losers: { label: '하락률', apiId: 'ka10027' },
        volume: { label: '거래량 상위', apiId: 'ka10030' },
        volumeSpike: { label: '거래량 급증', apiId: 'ka10023' },
    };
    const WATCHLIST_ITEM_LIMIT = 20;
    const WATCHLIST_VISIBLE_GROUP_COUNT = 4;
    const FAST_WATCHLIST_SOURCE_TYPES = new Set(['realtime', 'gainers', 'losers', 'volume', 'volumeSpike']);

    const escapeHtml = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const formatNumber = (value) => {
        if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
        return Number(value).toLocaleString('ko-KR');
    };

    const setRankingStatus = (message = '', show = Boolean(message)) => {
        if (!rankingStatus) return;
        rankingStatus.textContent = message;
        rankingStatus.classList.toggle('show', show);
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
            if (index === activeSearchIndex) item.scrollIntoView({ block: 'nearest' });
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
            const response = await authFetch(`/api/search?q=${encodeURIComponent(keyword)}`, { cache: 'no-store' });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
            renderSearchResults(payload.results || []);
        } catch (error) {
            console.error('Search request failed.', error);
            renderSearchMessage(error.message || '검색 중 오류가 발생했습니다.');
        }
    };

    const updateSearchClearButton = () => {
        searchClearButton?.classList.toggle('show', Boolean(searchBar?.value));
    };

    const renderRankingRow = (item, index, metricLabel = '') => {
        const directionClass = item.direction === 'up' ? ' is-up' : item.direction === 'down' ? ' is-down' : '';
        const code = escapeHtml(item.code || '');
        const target = escapeHtml(item.code || item.name || '');
        const priceText = item.price ? `${formatNumber(item.price)}원` : item.metric || '-';
        const volumeText = item.volume ? formatNumber(item.volume) : '-';
        const volumeCell = activeRankingType === 'realtime' ? '' : `<span class="home-ranking-volume">${escapeHtml(volumeText)}</span>`;
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
                <span class="home-ranking-rate">${escapeHtml(metricText || '-')}</span>
                ${volumeCell}
                <span class="home-ranking-refresh-space" aria-hidden="true"></span>
            </button>
        `;
    };

    const renderMoverRankingItems = (items = [], metricLabel = '', groups = {}) => {
        const gainers = groups.gainers || items.slice(0, 20);
        const losers = groups.losers || items.slice(20);

        rankingList.classList.add('is-mover-layout');
        rankingList.classList.remove('is-card-layout', 'is-row-layout', 'is-realtime-layout');
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
            renderMoverRankingItems(items, metricLabel, groups);
            return;
        }

        rankingList.classList.remove('is-card-layout', 'is-mover-layout');
        rankingList.classList.add('is-row-layout');
        rankingList.classList.toggle('is-realtime-layout', activeRankingType === 'realtime');
        rankingList.innerHTML = items.map((item, index) => renderRankingRow(item, index, metricLabel)).join('');
    };

    const setActiveBuiltinTab = (type) => {
        activeRankingType = type;
        activeWatchlistId = '';
        rankingTabs.forEach((tab) => tab.classList.toggle('is-active', tab.dataset.rankingType === type));
        watchlistGroupTabs?.querySelectorAll('[data-watchlist-id]').forEach((tab) => tab.classList.remove('is-active'));
    };

    const setActiveWatchlistTab = (groupId) => {
        activeRankingType = 'watchlist';
        activeWatchlistId = groupId;
        rankingTabs.forEach((tab) => tab.classList.remove('is-active'));
        watchlistGroupTabs?.querySelectorAll('[data-watchlist-id]').forEach((tab) => {
            tab.classList.toggle('is-active', tab.dataset.watchlistId === groupId);
        });
    };

    const loadRanking = async (type = activeRankingType) => {
        if (!rankingList) return;
        const meta = rankingTypeMeta[type] || rankingTypeMeta.realtime;

        setActiveBuiltinTab(type);
        if (rankingTitle) rankingTitle.textContent = meta.label;
        if (rankingSubtitle) rankingSubtitle.textContent = `키움 REST API ${meta.apiId} 기준 상위 목록`;
        rankingColumns?.classList.toggle('is-realtime', type === 'realtime');
        rankingColumns?.classList.toggle('is-mover', type === 'movers');
        rankingList.replaceChildren();
        setRankingStatus('랭킹을 불러오는 중...', true);

        rankingAbortController?.abort();
        rankingAbortController = new AbortController();

        try {
            const response = await authFetch(`/api/home-rankings?type=${encodeURIComponent(type)}&limit=20`, {
                cache: 'no-store',
                signal: rankingAbortController.signal,
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
            if (rankingSubtitle) rankingSubtitle.textContent = `키움 REST API ${payload.apiId || meta.apiId} 기준 상위 목록`;
            renderRankingItems(payload.items || [], payload.metricLabel || '', payload.groups || {});
        } catch (error) {
            if (error.name === 'AbortError') return;
            console.error('Home ranking request failed.', error);
            rankingList.replaceChildren();
            setRankingStatus(error.message || '랭킹을 불러오지 못했습니다.', true);
        }
    };

    const getPrimaryFastWatchlistSourceType = (savedItems = []) => {
        const counts = new Map();
        savedItems.forEach((item) => {
            const sourceType = item.sourceType || 'manual';
            if (!FAST_WATCHLIST_SOURCE_TYPES.has(sourceType)) return;
            counts.set(sourceType, (counts.get(sourceType) || 0) + 1);
        });

        return Array.from(counts.entries())
            .sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    };

    const getPendingWatchlistItem = (item, index) => ({
        rank: index + 1,
        code: item.code,
        name: item.name,
        price: null,
        change: null,
        changeRate: null,
        volume: null,
        direction: 'flat',
        metric: '조회 중',
    });

    const getFastWatchlistItems = async (group) => {
        const savedItems = group?.items || [];
        if (!savedItems.length) return { items: [], missingItems: [] };

        const sourceType = getPrimaryFastWatchlistSourceType(savedItems);
        if (!sourceType) return null;

        const response = await authFetch(`/api/home-rankings?type=${encodeURIComponent(sourceType)}&limit=20`, {
            cache: 'no-store',
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);

        const rankingItemsByCode = new Map((payload.items || []).map((item) => [item.code, item]));
        const missingItems = [];
        const items = savedItems.map((item, index) => {
            const rankingItem = rankingItemsByCode.get(item.code);
            if (rankingItem) {
                return {
                    ...rankingItem,
                    rank: index + 1,
                };
            }

            missingItems.push({ ...item, index });
            return getPendingWatchlistItem(item, index);
        });

        return { items, missingItems };
    };

    const hydrateMissingFastWatchlistItems = async (groupId, renderedItems, missingItems = []) => {
        if (!missingItems.length) return;

        const hydratedItems = [...renderedItems];
        await Promise.all(missingItems.map(async (item) => {
            try {
                const response = await authFetch(`/api/stock/${encodeURIComponent(item.code)}`, { cache: 'no-store' });
                const stock = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(stock.message || `HTTP ${response.status}`);
                hydratedItems[item.index] = {
                    rank: item.index + 1,
                    code: stock.code || item.code,
                    name: stock.name || item.name,
                    price: stock.price,
                    change: stock.change,
                    changeRate: stock.changeRate,
                    volume: stock.volume,
                    direction: stock.direction,
                };
            } catch (error) {
                hydratedItems[item.index] = {
                    ...getPendingWatchlistItem(item, item.index),
                    metric: error.message?.includes('429') ? '요청 제한' : '조회 실패',
                };
            }
        }));

        if (activeWatchlistId === groupId) {
            renderRankingItems(hydratedItems, '', {});
        }
    };

    const loadWatchlistQuotes = async (groupId) => {
        if (!rankingList) return;
        const group = watchlistGroups.find((item) => item.id === groupId);
        setActiveWatchlistTab(groupId);
        if (rankingTitle) rankingTitle.textContent = group?.name || '관심 그룹';
        if (rankingSubtitle) rankingSubtitle.textContent = '저장한 관심 종목의 현재가, 등락률, 거래량';
        rankingColumns?.classList.remove('is-realtime', 'is-mover');
        rankingList.replaceChildren();
        setRankingStatus('관심 종목을 불러오는 중...', true);

        try {
            const fastResult = await getFastWatchlistItems(group);
            if (fastResult) {
                renderRankingItems(fastResult.items, '', {});
                hydrateMissingFastWatchlistItems(groupId, fastResult.items, fastResult.missingItems);
                return;
            }

            const response = await authFetch(`/api/watchlists/${encodeURIComponent(groupId)}/quotes`, { cache: 'no-store' });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
            renderRankingItems(payload.items || [], '', {});
        } catch (error) {
            console.error('Watchlist quote request failed.', error);
            rankingList.replaceChildren();
            setRankingStatus(error.message || '관심 종목을 불러오지 못했습니다.', true);
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

        searchStocks(keyword).then(() => moveActiveSearchResult(direction));
    };

    const getEditingPayload = () => editingItems.map((item, index) => ({
        code: item.code,
        name: item.name,
        sourceType: item.sourceType || 'manual',
        sortOrder: index,
    }));

    const showWatchlistLimitMessage = () => {
        alert(`관심 그룹에는 최대 ${WATCHLIST_ITEM_LIMIT}개 종목만 담을 수 있습니다.`);
    };

    const normalizeWatchlistItems = (items = [], sourceType = 'manual') => {
        const seenCodes = new Set();
        return items
            .map((item) => ({
                code: String(item.code || '').replace(/^A/i, '').trim(),
                name: String(item.name || '').trim(),
                sourceType,
            }))
            .filter((item) => {
                if (!item.code || !item.name || seenCodes.has(item.code)) return false;
                seenCodes.add(item.code);
                return true;
            });
    };

    const dedupeAppendEditingItems = (items = [], sourceType = 'manual') => {
        if (editingItems.length >= WATCHLIST_ITEM_LIMIT) {
            showWatchlistLimitMessage();
            return;
        }

        const existingCodes = new Set(editingItems.map((item) => item.code));
        const additions = normalizeWatchlistItems(items, sourceType)
            .filter((item) => !existingCodes.has(item.code));
        const availableSlots = WATCHLIST_ITEM_LIMIT - editingItems.length;
        if (additions.length > availableSlots) showWatchlistLimitMessage();
        editingItems = [...editingItems, ...additions];
        editingItems = editingItems.slice(0, WATCHLIST_ITEM_LIMIT);
        renderEditingItems();
    };

    const replaceEditingItems = (items = [], sourceType = 'manual') => {
        const normalizedItems = normalizeWatchlistItems(items, sourceType);
        editingItems = normalizedItems.slice(0, WATCHLIST_ITEM_LIMIT);
        renderEditingItems();
    };

    const renderWatchlistTabs = () => {
        if (!watchlistGroupTabs) return;
        const hasOverflow = watchlistGroups.length > WATCHLIST_VISIBLE_GROUP_COUNT;
        const tabs = watchlistGroups.map((group) => `
            <button class="home-ranking-tab watchlist-tab${group.id === activeWatchlistId ? ' is-active' : ''}" type="button" data-watchlist-id="${escapeHtml(group.id)}">
                ${escapeHtml(group.name)}
            </button>
        `).join('');

        watchlistGroupTabs.innerHTML = `
            <button class="watchlist-scroll-button is-left${hasOverflow ? '' : ' is-disabled'}" type="button" data-watchlist-scroll="-1" aria-label="관심 그룹 왼쪽으로 이동" ${hasOverflow ? '' : 'disabled'}>
                <i class="fa-solid fa-chevron-left" aria-hidden="true"></i>
            </button>
            <button id="watchlistManageButton" class="home-ranking-tab watchlist-manage-tab" type="button" title="관심 그룹 관리">
                <i class="fa-solid fa-star" aria-hidden="true"></i>
                관심 그룹 +
            </button>
            <div class="watchlist-tabs-viewport">
                <div class="watchlist-tabs-track">${tabs}</div>
            </div>
            <button class="watchlist-scroll-button is-right${hasOverflow ? '' : ' is-disabled'}" type="button" data-watchlist-scroll="1" aria-label="관심 그룹 오른쪽으로 이동" ${hasOverflow ? '' : 'disabled'}>
                <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
            </button>
        `;
    };

    const renderWatchlistGroupList = () => {
        if (!watchlistGroupList) return;
        if (!watchlistGroups.length) {
            watchlistGroupList.innerHTML = '<div class="watchlist-empty">등록된 관심 그룹이 없습니다.</div>';
            return;
        }

        watchlistGroupList.innerHTML = watchlistGroups.map((group) => `
            <button class="watchlist-group-row" type="button" data-edit-watchlist-id="${escapeHtml(group.id)}">
                <span>${escapeHtml(group.name)}</span>
                <span class="watchlist-group-meta">
                    <small>${formatNumber(group.items?.length || 0)}개 종목</small>
                    <span class="watchlist-group-delete" role="button" tabindex="0" data-delete-watchlist-id="${escapeHtml(group.id)}" aria-label="${escapeHtml(group.name)} 삭제">
                        <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                    </span>
                </span>
            </button>
        `).join('');
    };

    const loadWatchlists = async () => {
        try {
            const response = await authFetch('/api/watchlists', { cache: 'no-store' });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
            watchlistGroups = payload.groups || [];
            renderWatchlistTabs();
            renderWatchlistGroupList();
        } catch (error) {
            console.error('Watchlist load failed.', error);
        }
    };

    const showWatchlistListPane = () => {
        editingGroup = null;
        editingItems = [];
        watchlistListPane?.classList.remove('is-hidden');
        watchlistEditPane?.classList.add('is-hidden');
        renderWatchlistGroupList();
    };

    const showWatchlistEditPane = (group) => {
        editingGroup = group;
        editingItems = [...(group.items || [])].map((item) => ({ ...item }));
        if (watchlistEditName) watchlistEditName.value = group.name;
        if (watchlistSourceType) watchlistSourceType.value = 'manual';
        if (watchlistStockSearch) watchlistStockSearch.value = '';
        watchlistStockResults?.classList.add('is-hidden');
        watchlistStockResults?.replaceChildren();
        watchlistListPane?.classList.add('is-hidden');
        watchlistEditPane?.classList.remove('is-hidden');
        renderEditingItems();
    };

    const openWatchlistModal = () => {
        watchlistModal?.classList.remove('hidden');
        showWatchlistListPane();
        watchlistGroupName?.focus();
    };

    const closeWatchlistModal = () => {
        watchlistModal?.classList.add('hidden');
    };

    const renderEditingItems = () => {
        if (!watchlistSelectedList) return;
        if (!editingItems.length) {
            watchlistSelectedList.innerHTML = '<div class="watchlist-empty">아직 추가된 종목이 없습니다.</div>';
            return;
        }

        watchlistSelectedList.innerHTML = editingItems.map((item, index) => `
            <div class="watchlist-selected-row${item.code === draggingWatchlistCode ? ' is-dragging' : ''}" draggable="true" data-editing-index="${index}" data-editing-code="${escapeHtml(item.code)}">
                <i class="fa-solid fa-grip-lines" aria-hidden="true"></i>
                <span class="watchlist-selected-rank">${index + 1}</span>
                <strong>${escapeHtml(item.name)}</strong>
                <small>${escapeHtml(item.code)}</small>
                <button type="button" data-remove-editing-index="${index}" aria-label="종목 삭제">
                    <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                </button>
            </div>
        `).join('');
    };

    const animateEditingReorder = (previousRects) => {
        if (!watchlistSelectedList || !previousRects?.size) return;

        const rows = Array.from(watchlistSelectedList.querySelectorAll('[data-editing-code]'));
        rows.forEach((row) => {
            const previousRect = previousRects.get(row.dataset.editingCode);
            if (!previousRect) return;

            const nextRect = row.getBoundingClientRect();
            const deltaY = previousRect.top - nextRect.top;
            if (Math.abs(deltaY) < 1) return;

            row.style.transition = 'none';
            row.style.transform = `translateY(${deltaY}px)`;
            row.getBoundingClientRect();
            requestAnimationFrame(() => {
                row.style.transition = '';
                row.style.transform = '';
            });
        });
    };

    const renderEditingItemsWithMotion = (previousRects) => {
        renderEditingItems();
        requestAnimationFrame(() => animateEditingReorder(previousRects));
    };

    const getEditingRowRects = () => {
        if (!watchlistSelectedList) return new Map();
        return new Map(Array.from(watchlistSelectedList.querySelectorAll('[data-editing-code]')).map((row) => [
            row.dataset.editingCode,
            row.getBoundingClientRect(),
        ]));
    };

    const createWatchlistGroup = async () => {
        const name = watchlistGroupName?.value.trim();
        if (!name) {
            watchlistGroupName?.focus();
            return;
        }

        const response = await authFetch('/api/watchlists', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);

        if (watchlistGroupName) watchlistGroupName.value = '';
        await loadWatchlists();
        const group = watchlistGroups.find((item) => item.id === payload.group?.id) || payload.group;
        showWatchlistEditPane(group);
    };

    const saveEditingGroup = async () => {
        if (!editingGroup) return;
        const name = watchlistEditName?.value.trim() || editingGroup.name;
        if (editingItems.length > WATCHLIST_ITEM_LIMIT) {
            showWatchlistLimitMessage();
            return;
        }

        const response = await authFetch(`/api/watchlists/${encodeURIComponent(editingGroup.id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name,
                items: getEditingPayload(),
            }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);

        await loadWatchlists();
        const updated = watchlistGroups.find((group) => group.id === editingGroup.id);
        if (updated) showWatchlistEditPane(updated);
        if (activeWatchlistId === editingGroup.id) loadWatchlistQuotes(editingGroup.id);
    };

    const deleteEditingGroup = async () => {
        if (!editingGroup) return;
        const response = await authFetch(`/api/watchlists/${encodeURIComponent(editingGroup.id)}`, { method: 'DELETE' });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);

        const deletedActiveGroup = activeWatchlistId === editingGroup.id;
        await loadWatchlists();
        showWatchlistListPane();
        if (deletedActiveGroup) loadRanking('realtime');
    };

    const renderWatchlistSearchResults = (results = []) => {
        if (!watchlistStockResults) return;
        const previousResults = latestWatchlistSearchResults;
        const previousActiveIndex = activeWatchlistSearchIndex;
        const isSameResultSet = previousResults.length === results.length
            && previousResults.every((stock, index) => stock.code === results[index]?.code);

        latestWatchlistSearchResults = results;
        activeWatchlistSearchIndex = results.length
            ? (isSameResultSet && previousActiveIndex >= 0 ? Math.min(previousActiveIndex, results.length - 1) : 0)
            : -1;

        if (!results.length) {
            watchlistStockResults.innerHTML = '<div class="watchlist-empty">검색 결과가 없습니다.</div>';
            watchlistStockResults.classList.remove('is-hidden');
            return;
        }

        watchlistStockResults.innerHTML = results.map((stock, index) => `
            <button type="button" class="watchlist-search-result${index === activeWatchlistSearchIndex ? ' is-active' : ''}" data-watchlist-search-code="${escapeHtml(stock.code)}" data-watchlist-search-name="${escapeHtml(stock.name)}" data-watchlist-search-index="${index}">
                <strong>${escapeHtml(stock.name)}</strong>
                <small>${escapeHtml(stock.code)}</small>
            </button>
        `).join('');
        watchlistStockResults.classList.remove('is-hidden');
    };

    const searchWatchlistStocks = async (query) => {
        const keyword = String(query || '').trim();
        if (!keyword) {
            latestWatchlistSearchResults = [];
            activeWatchlistSearchIndex = -1;
            watchlistStockResults?.replaceChildren();
            watchlistStockResults?.classList.add('is-hidden');
            return;
        }

        try {
            const response = await authFetch(`/api/search?q=${encodeURIComponent(keyword)}`, { cache: 'no-store' });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
            renderWatchlistSearchResults(payload.results || []);
        } catch (error) {
            console.error('Watchlist stock search failed.', error);
            renderWatchlistSearchResults([]);
        }
    };

    const updateActiveWatchlistSearchResult = () => {
        if (!watchlistStockResults) return;
        const items = Array.from(watchlistStockResults.querySelectorAll('.watchlist-search-result'));
        items.forEach((item, index) => {
            item.classList.toggle('is-active', index === activeWatchlistSearchIndex);
            if (index === activeWatchlistSearchIndex) item.scrollIntoView({ block: 'nearest' });
        });
    };

    const hydrateWatchlistSearchResultsFromDom = () => {
        if (!watchlistStockResults) return false;
        const items = Array.from(watchlistStockResults.querySelectorAll('.watchlist-search-result'));
        if (!items.length) return false;

        latestWatchlistSearchResults = items.map((item) => ({
            code: item.dataset.watchlistSearchCode || '',
            name: item.dataset.watchlistSearchName || item.querySelector('strong')?.textContent?.trim() || '',
        })).filter((stock) => stock.code);

        if (!latestWatchlistSearchResults.length) return false;

        const activeItemIndex = items.findIndex((item) => item.classList.contains('is-active'));
        activeWatchlistSearchIndex = activeItemIndex >= 0 ? activeItemIndex : 0;
        return true;
    };

    const moveActiveWatchlistSearchResult = (direction) => {
        if (!latestWatchlistSearchResults.length && !hydrateWatchlistSearchResultsFromDom()) return;
        activeWatchlistSearchIndex = (activeWatchlistSearchIndex + direction + latestWatchlistSearchResults.length)
            % latestWatchlistSearchResults.length;
        updateActiveWatchlistSearchResult();
    };

    const addWatchlistSearchResult = (stock) => {
        if (!stock?.code) return false;
        const beforeCount = editingItems.length;
        dedupeAppendEditingItems([{ code: stock.code, name: stock.name }], 'manual');
        if (editingItems.length === beforeCount) return false;

        if (watchlistStockSearch) watchlistStockSearch.value = '';
        latestWatchlistSearchResults = [];
        activeWatchlistSearchIndex = -1;
        watchlistStockResults?.replaceChildren();
        watchlistStockResults?.classList.add('is-hidden');
        return true;
    };

    const loadSourceRankingIntoEditor = async () => {
        const type = watchlistSourceType?.value || 'manual';
        if (type === 'manual') return;

        const response = await authFetch(`/api/home-rankings?type=${encodeURIComponent(type)}&limit=20`, { cache: 'no-store' });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
        replaceEditingItems(payload.items || [], type);
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

    sidebarToggle?.addEventListener('click', () => {
        if (!appSidebar) return;
        const isCompact = window.matchMedia('(max-width: 1100px)').matches;
        if (isCompact) {
            document.body.classList.toggle('compact-sidebar-open');
            sidebarToggle.setAttribute('aria-expanded', String(document.body.classList.contains('compact-sidebar-open')));
            return;
        }

        appSidebar.classList.toggle('is-collapsed');
        sidebarToggle.setAttribute('aria-expanded', String(!appSidebar.classList.contains('is-collapsed')));
    });

    if (searchBar && searchModal && searchResults) {
        updateSearchClearButton();

        searchBar.addEventListener('focus', () => {
            searchModal.classList.add('show');
            const keyword = searchBar.value.trim();
            if (keyword) searchStocks(keyword);
            else {
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

        searchClearButton?.addEventListener('mousedown', (event) => event.preventDefault());
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
            if (!searchModal.contains(event.target) && event.target !== searchBar && event.target !== searchClearButton) {
                searchModal.classList.remove('show');
            }
        });
    }

    rankingTabs.forEach((tab) => {
        tab.addEventListener('click', () => loadRanking(tab.dataset.rankingType || 'realtime'));
    });

    rankingRefresh?.addEventListener('click', () => {
        if (activeWatchlistId) loadWatchlistQuotes(activeWatchlistId);
        else loadRanking(activeRankingType);
    });

    rankingList?.addEventListener('click', (event) => {
        const card = event.target.closest('.home-ranking-card');
        if (!card) return;
        openTradingPage(card.dataset.target);
    });

    watchlistGroupTabs?.addEventListener('click', (event) => {
        const manageButton = event.target.closest('#watchlistManageButton');
        if (manageButton) {
            openWatchlistModal();
            return;
        }

        const scrollButton = event.target.closest('[data-watchlist-scroll]');
        if (scrollButton) {
            const viewport = watchlistGroupTabs.querySelector('.watchlist-tabs-viewport');
            const track = watchlistGroupTabs.querySelector('.watchlist-tabs-track');
            if (!viewport || !track || track.scrollWidth <= viewport.clientWidth + 2) return;
            const direction = Number(scrollButton.dataset.watchlistScroll || 1);
            viewport.scrollBy({
                left: direction * viewport.clientWidth,
                behavior: 'smooth',
            });
            return;
        }

        const tab = event.target.closest('[data-watchlist-id]');
        if (tab) loadWatchlistQuotes(tab.dataset.watchlistId);
    });

    watchlistManageButton?.addEventListener('click', openWatchlistModal);
    watchlistModalClose?.addEventListener('click', closeWatchlistModal);
    watchlistModal?.addEventListener('click', (event) => {
        if (event.target === watchlistModal) closeWatchlistModal();
    });

    watchlistGroupAddBtn?.addEventListener('click', () => {
        createWatchlistGroup().catch((error) => {
            console.error('Watchlist group create failed.', error);
            alert(error.message || '관심 그룹을 만들지 못했습니다.');
        });
    });

    watchlistGroupName?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        watchlistGroupAddBtn?.click();
    });

    watchlistGroupList?.addEventListener('click', (event) => {
        const deleteButton = event.target.closest('[data-delete-watchlist-id]');
        if (deleteButton) {
            event.stopPropagation();
            const groupId = deleteButton.dataset.deleteWatchlistId;
            const group = watchlistGroups.find((item) => item.id === groupId);
            if (!group || !confirm(`${group.name} 관심 그룹을 삭제할까요?`)) return;

            authFetch(`/api/watchlists/${encodeURIComponent(groupId)}`, { method: 'DELETE' })
                .then(async (response) => {
                    const payload = await response.json().catch(() => ({}));
                    if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
                    if (activeWatchlistId === groupId) loadRanking('realtime');
                    return loadWatchlists();
                })
                .catch((error) => {
                    console.error('Watchlist delete failed.', error);
                    alert(error.message || '관심 그룹을 삭제하지 못했습니다.');
                });
            return;
        }

        const row = event.target.closest('[data-edit-watchlist-id]');
        if (!row) return;
        const group = watchlistGroups.find((item) => item.id === row.dataset.editWatchlistId);
        if (group) showWatchlistEditPane(group);
    });

    watchlistEditBack?.addEventListener('click', showWatchlistListPane);
    watchlistSourceLoad?.addEventListener('click', () => {
        loadSourceRankingIntoEditor().catch((error) => {
            console.error('Watchlist source load failed.', error);
            alert(error.message || '종목모음을 불러오지 못했습니다.');
        });
    });

    watchlistSourceType?.addEventListener('change', () => {
        if (watchlistSourceType.value === 'manual') {
            editingItems = [];
            renderEditingItems();
            return;
        }
        loadSourceRankingIntoEditor().catch((error) => {
            console.error('Watchlist source load failed.', error);
            alert(error.message || '종목모음을 불러오지 못했습니다.');
            watchlistSourceType.value = 'manual';
        });
    });

    watchlistStockSearch?.addEventListener('input', () => {
        clearTimeout(watchlistSearchTimer);
        watchlistSearchTimer = setTimeout(() => searchWatchlistStocks(watchlistStockSearch.value), 250);
    });

    watchlistStockSearch?.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            clearTimeout(watchlistSearchTimer);
            moveActiveWatchlistSearchResult(1);
            return;
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault();
            clearTimeout(watchlistSearchTimer);
            moveActiveWatchlistSearchResult(-1);
            return;
        }

        if (event.key !== 'Enter') return;
        clearTimeout(watchlistSearchTimer);
        if (!latestWatchlistSearchResults.length && !hydrateWatchlistSearchResultsFromDom()) return;

        event.preventDefault();
        const selected = latestWatchlistSearchResults[
            activeWatchlistSearchIndex >= 0 ? activeWatchlistSearchIndex : 0
        ];
        addWatchlistSearchResult(selected);
    });

    watchlistStockResults?.addEventListener('click', (event) => {
        const result = event.target.closest('[data-watchlist-search-code]');
        if (!result) return;
        activeWatchlistSearchIndex = Number(result.dataset.watchlistSearchIndex || -1);
        addWatchlistSearchResult({
            code: result.dataset.watchlistSearchCode,
            name: result.dataset.watchlistSearchName,
        });
    });

    watchlistSelectedList?.addEventListener('click', (event) => {
        const removeButton = event.target.closest('[data-remove-editing-index]');
        if (!removeButton) return;
        editingItems.splice(Number(removeButton.dataset.removeEditingIndex), 1);
        renderEditingItems();
    });

    watchlistSelectedList?.addEventListener('dragstart', (event) => {
        const row = event.target.closest('[data-editing-index]');
        if (!row) return;
        const index = Number(row.dataset.editingIndex);
        draggingWatchlistCode = editingItems[index]?.code || '';
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', draggingWatchlistCode);
        watchlistSelectedList.classList.add('is-reordering');
        row.classList.add('is-dragging');
    });

    watchlistSelectedList?.addEventListener('dragend', (event) => {
        draggingWatchlistCode = '';
        watchlistSelectedList.classList.remove('is-reordering');
        event.target.closest('[data-editing-index]')?.classList.remove('is-dragging');
        renderEditingItems();
    });

    watchlistSelectedList?.addEventListener('dragover', (event) => {
        const row = event.target.closest('[data-editing-index]');
        if (!row || !draggingWatchlistCode) return;

        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';

        const fromIndex = editingItems.findIndex((item) => item.code === draggingWatchlistCode);
        const hoverIndex = Number(row.dataset.editingIndex);
        if (fromIndex < 0 || Number.isNaN(hoverIndex)) return;

        const rect = row.getBoundingClientRect();
        const insertAfter = event.clientY > rect.top + rect.height / 2;
        let toIndex = hoverIndex + (insertAfter ? 1 : 0);
        if (fromIndex < toIndex) toIndex -= 1;
        if (fromIndex === toIndex) return;

        const previousRects = getEditingRowRects();
        const [moved] = editingItems.splice(fromIndex, 1);
        editingItems.splice(toIndex, 0, moved);
        renderEditingItemsWithMotion(previousRects);
    });

    watchlistSelectedList?.addEventListener('drop', (event) => {
        event.preventDefault();
        draggingWatchlistCode = '';
        watchlistSelectedList.classList.remove('is-reordering');
        renderEditingItems();
    });

    watchlistSaveButton?.addEventListener('click', async () => {
        try {
            await saveEditingGroup();
            alert('관심 그룹이 저장되었습니다.');
        } catch (error) {
            console.error('Watchlist save failed.', error);
            alert(error.message || '관심 그룹을 저장하지 못했습니다.');
        }
    });

    watchlistResetButton?.addEventListener('click', () => {
        editingItems = [];
        if (watchlistSourceType) watchlistSourceType.value = 'manual';
        if (watchlistStockSearch) watchlistStockSearch.value = '';
        watchlistStockResults?.classList.add('is-hidden');
        renderEditingItems();
    });

    watchlistDeleteButton?.addEventListener('click', () => {
        if (!confirm('관심 그룹을 삭제할까요?')) return;
        deleteEditingGroup().catch((error) => {
            console.error('Watchlist delete failed.', error);
            alert(error.message || '관심 그룹을 삭제하지 못했습니다.');
        });
    });

    loadRanking(activeRankingType);
    loadWatchlists();
});
