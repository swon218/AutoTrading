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
    const refreshButton = document.getElementById('assetRefreshButton');
    const updatedAt = document.getElementById('assetUpdatedAt');
    const status = document.getElementById('assetStatus');
    const holdingCount = document.getElementById('assetHoldingCount');
    const allocationList = document.getElementById('assetAllocationList');
    const holdingList = document.getElementById('assetHoldingList');
    const holdingHeader = document.querySelector('.asset-holding-header');
    const assetListTabs = Array.from(document.querySelectorAll('[data-asset-list-tab]'));
    const totalEvaluation = document.getElementById('assetTotalEvaluation');
    const totalPurchase = document.getElementById('assetTotalPurchase');
    const totalProfit = document.getElementById('assetTotalProfit');
    const orderableCash = document.getElementById('assetOrderableCash');

    let searchTimer = null;
    let latestResults = [];
    let activeSearchIndex = -1;
    let portfolioAbortController = null;
    let pendingAbortController = null;
    let activeAssetListTab = 'holdings';
    let latestPortfolioPayload = null;

    const escapeHtml = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const formatNumber = (value) => {
        const number = Number(value);
        return Number.isFinite(number) ? number.toLocaleString('ko-KR') : '-';
    };

    const formatWon = (value) => {
        const number = Number(value);
        return Number.isFinite(number) ? `${number.toLocaleString('ko-KR')}원` : '-';
    };

    const formatRate = (value) => {
        const number = Number(value);
        return Number.isFinite(number) ? `${number.toFixed(2)}%` : '-';
    };

    const setStatus = (message = '', show = Boolean(message)) => {
        if (!status) return;
        status.textContent = message;
        status.classList.toggle('show', show);
    };

    const setSignedText = (element, value, formatter = formatWon) => {
        if (!element) return;
        const number = Number(value);
        element.textContent = formatter(number);
        element.classList.toggle('is-up', number > 0);
        element.classList.toggle('is-down', number < 0);
    };

    const renderSearchMessage = (message) => {
        if (!searchResults) return;
        latestResults = [];
        activeSearchIndex = -1;
        searchResults.innerHTML = `<div class="search-empty">${escapeHtml(message)}</div>`;
    };

    const renderSearchResults = (results = []) => {
        if (!searchResults) return;
        latestResults = results;
        activeSearchIndex = results.length ? 0 : -1;
        if (!results.length) {
            renderSearchMessage('검색 결과가 없습니다.');
            return;
        }
        searchResults.innerHTML = results.map((stock, index) => `
            <button class="search-result-item${index === activeSearchIndex ? ' is-active' : ''}" type="button" data-code="${escapeHtml(stock.code)}" data-index="${index}">
                <span class="search-result-name">${escapeHtml(stock.name)}</span>
                <span class="search-result-code">${escapeHtml(stock.code)}</span>
            </button>
        `).join('');
    };

    const updateActiveSearchResult = () => {
        if (!searchResults) return;
        Array.from(searchResults.querySelectorAll('.search-result-item')).forEach((item, index) => {
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
        activeSearchIndex = Math.max(0, items.findIndex((item) => item.classList.contains('is-active')));
        return Boolean(latestResults.length);
    };

    const moveActiveSearchResult = (direction) => {
        if (!latestResults.length && !hydrateSearchResultsFromDom()) return;
        activeSearchIndex = (activeSearchIndex + direction + latestResults.length) % latestResults.length;
        updateActiveSearchResult();
    };

    const searchStocks = async (query) => {
        const keyword = String(query || '').trim();
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
            renderSearchMessage('검색 중 오류가 발생했습니다.');
        }
    };

    const updateSearchClearButton = () => {
        searchClearButton?.classList.toggle('show', Boolean(searchBar?.value));
    };

    const openTradingPage = (query) => {
        const target = String(query || '').replace(/_.+$/, '').trim();
        if (!target) return;
        window.location.href = `trading.html?code=${encodeURIComponent(target)}`;
    };

    const renderEmptyPortfolio = () => {
        if (allocationList) {
            allocationList.innerHTML = '<div class="asset-empty">보유 종목이 없습니다.</div>';
        }
        if (holdingList) {
            holdingList.innerHTML = '<div class="asset-empty">계좌에 표시할 보유 종목이 없습니다.</div>';
        }
    };

    const setAssetListTab = (tabName = 'holdings') => {
        activeAssetListTab = tabName === 'pending' ? 'pending' : 'holdings';
        assetListTabs.forEach((button) => {
            const isActive = button.dataset.assetListTab === activeAssetListTab;
            button.classList.toggle('is-active', isActive);
            button.setAttribute('aria-selected', String(isActive));
        });
    };

    const setHoldingHeader = (columns = []) => {
        if (!holdingHeader) return;
        holdingHeader.innerHTML = columns.map((column) => `<span>${escapeHtml(column)}</span>`).join('');
        holdingHeader.classList.toggle('is-pending', activeAssetListTab === 'pending');
    };

    const renderPendingOrders = (orders = []) => {
        setAssetListTab('pending');
        setHoldingHeader(['종목', '구분', '주문가', '미체결', '상태']);
        if (holdingCount) holdingCount.textContent = `${orders.length}건`;

        if (!holdingList) return;
        if (!orders.length) {
            holdingList.innerHTML = '<div class="asset-empty">미체결 주문이 없습니다.</div>';
            setStatus('', false);
            return;
        }

        holdingList.innerHTML = orders.map((order) => {
            const sideClass = order.side === 'sell' ? ' is-down' : ' is-up';
            return `
                <button class="asset-holding-row asset-pending-row" type="button" data-code="${escapeHtml(order.stockCode)}">
                    <span class="asset-holding-name">
                        <strong>${escapeHtml(order.stockName || order.stockCode || '-')}</strong>
                        <small>${escapeHtml(order.stockCode || '')}</small>
                    </span>
                    <span class="${sideClass.trim()}">${escapeHtml(order.sideLabel || '-')}</span>
                    <span>${formatWon(order.orderPrice)}</span>
                    <span>${formatNumber(order.pendingQuantity)}주</span>
                    <span>${escapeHtml(order.orderStatus || '접수')}</span>
                </button>
            `;
        }).join('');
        setStatus('', false);
    };

    const renderPortfolio = (payload) => {
        latestPortfolioPayload = payload;
        setAssetListTab('holdings');
        setHoldingHeader(['종목', '매입가', '보유수량', '현재가', '수수료/세금', '손익률']);
        const holdings = payload.holdings || [];
        const summary = payload.summary || {};
        const totalEvaluationAmount = Number(summary.totalEvaluationAmount) || holdings.reduce((sum, item) => sum + (Number(item.evaluationAmount) || 0), 0);

        if (totalEvaluation) totalEvaluation.textContent = formatWon(totalEvaluationAmount);
        if (totalPurchase) totalPurchase.textContent = formatWon(summary.totalPurchaseAmount);
        setSignedText(totalProfit, summary.totalProfitLoss);
        if (orderableCash) {
            orderableCash.textContent = summary.orderableAmount === null || summary.orderableAmount === undefined
                ? '계좌 조회 실패'
                : formatWon(summary.orderableAmount);
            orderableCash.classList.toggle('is-down', summary.orderableAmount === null || summary.orderableAmount === undefined);
        }
        if (holdingCount) holdingCount.textContent = `${holdings.length}종목`;

        if (!holdings.length) {
            renderEmptyPortfolio();
            setStatus('', false);
            return;
        }

        const sortedHoldings = [...holdings].sort((a, b) => (Number(b.evaluationAmount) || 0) - (Number(a.evaluationAmount) || 0));

        if (allocationList) {
            allocationList.innerHTML = sortedHoldings.map((item) => {
                const evaluationAmount = Number(item.evaluationAmount) || 0;
                const weight = totalEvaluationAmount ? Math.max(0, evaluationAmount / totalEvaluationAmount * 100) : 0;
                return `
                    <button class="asset-allocation-row" type="button" data-code="${escapeHtml(item.stockCode)}">
                        <span class="asset-allocation-name">
                            <strong>${escapeHtml(item.stockName || item.stockCode || '-')}</strong>
                            <small>${escapeHtml(item.stockCode || '')}</small>
                        </span>
                        <span class="asset-allocation-track"><span style="width: ${Math.min(100, weight).toFixed(2)}%"></span></span>
                        <span class="asset-allocation-weight">${weight.toFixed(1)}%</span>
                    </button>
                `;
            }).join('');
        }

        if (holdingList) {
            holdingList.innerHTML = sortedHoldings.map((item) => {
                const profitLoss = Number(item.profitLoss) || 0;
                const profitClass = profitLoss > 0 ? ' is-up' : profitLoss < 0 ? ' is-down' : '';
                return `
                    <button class="asset-holding-row" type="button" data-code="${escapeHtml(item.stockCode)}">
                        <span class="asset-holding-name">
                            <strong>${escapeHtml(item.stockName || item.stockCode || '-')}</strong>
                            <small>${escapeHtml(item.stockCode || '')}</small>
                        </span>
                        <span>${Number(item.averagePrice) ? formatWon(item.averagePrice) : '-'}</span>
                        <span>${formatNumber(item.holdingQuantity)}주</span>
                        <span>${formatWon(item.currentPrice)}</span>
                        <span class="asset-fee-tax-cell">
                            <strong>${formatWon(item.commissionAmount)}</strong>
                            <small>${formatWon(item.taxAmount)}</small>
                        </span>
                        <span class="asset-profit-cell ${profitClass.trim()}">
                            <strong>${formatRate(item.profitRate)}</strong>
                            <small>${formatWon(item.profitLoss)}</small>
                        </span>
                    </button>
                `;
            }).join('');
        }

        setStatus('', false);
    };

    const loadPortfolio = async () => {
        if (portfolioAbortController) portfolioAbortController.abort();
        portfolioAbortController = new AbortController();
        refreshButton?.classList.add('is-loading');
        setStatus('계좌 보유종목을 불러오는 중...', true);

        try {
            const response = await authFetch('/api/account/portfolio', {
                cache: 'no-store',
                signal: portfolioAbortController.signal,
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
            renderPortfolio(payload);
            if (updatedAt) {
                updatedAt.textContent = `마지막 조회 ${new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
            }
        } catch (error) {
            if (error.name === 'AbortError') return;
            console.error('Portfolio request failed.', error);
            renderEmptyPortfolio();
            setStatus(error.message || '자산 현황을 불러오지 못했습니다.', true);
            if (updatedAt) updatedAt.textContent = '계좌 조회 실패';
        } finally {
            refreshButton?.classList.remove('is-loading');
        }
    };

    const loadPendingOrders = async () => {
        if (pendingAbortController) pendingAbortController.abort();
        pendingAbortController = new AbortController();
        setAssetListTab('pending');
        setHoldingHeader(['종목', '구분', '주문가', '미체결', '상태']);
        if (holdingList) holdingList.innerHTML = '';
        if (holdingCount) holdingCount.textContent = '조회 중';
        setStatus('미체결 주문을 불러오는 중...', true);

        try {
            const response = await authFetch('/api/orders/pending', {
                cache: 'no-store',
                signal: pendingAbortController.signal,
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
            renderPendingOrders(payload.orders || []);
        } catch (error) {
            if (error.name === 'AbortError') return;
            console.error('Pending order request failed.', error);
            if (holdingList) {
                holdingList.innerHTML = '<div class="asset-empty">미체결 주문을 조회하지 못했습니다.</div>';
            }
            if (holdingCount) holdingCount.textContent = '0건';
            setStatus(error.message || '미체결 주문을 불러오지 못했습니다.', true);
        }
    };

    profileBtn?.addEventListener('click', (event) => {
        event.stopPropagation();
        profileMenu?.classList.toggle('hidden');
    });

    document.addEventListener('click', (event) => {
        if (profileMenu && !profileMenu.classList.contains('hidden') && !profileMenu.contains(event.target)) {
            profileMenu.classList.add('hidden');
        }
    });

    sidebarToggle?.addEventListener('click', () => {
        const isCompact = window.matchMedia('(max-width: 1100px)').matches;
        if (isCompact) {
            document.body.classList.toggle('compact-sidebar-open');
            sidebarToggle.setAttribute('aria-expanded', String(document.body.classList.contains('compact-sidebar-open')));
            return;
        }
        appSidebar?.classList.toggle('is-collapsed');
        sidebarToggle.setAttribute('aria-expanded', String(!appSidebar?.classList.contains('is-collapsed')));
    });

    if (searchBar && searchModal && searchResults) {
        updateSearchClearButton();
        searchBar.addEventListener('focus', () => {
            searchModal.classList.add('show');
            const keyword = searchBar.value.trim();
            if (keyword) searchStocks(keyword);
            else renderSearchMessage('종목명 또는 종목코드를 입력하세요.');
        });
        searchBar.addEventListener('input', () => {
            searchModal.classList.add('show');
            updateSearchClearButton();
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => searchStocks(searchBar.value), 250);
        });
        searchClearButton?.addEventListener('mousedown', (event) => event.preventDefault());
        searchClearButton?.addEventListener('click', (event) => {
            event.stopPropagation();
            clearTimeout(searchTimer);
            searchBar.value = '';
            updateSearchClearButton();
            renderSearchMessage('종목명 또는 종목코드를 입력하세요.');
            searchModal.classList.add('show');
            searchBar.focus();
        });
        searchBar.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                moveActiveSearchResult(1);
                return;
            }
            if (event.key === 'ArrowUp') {
                event.preventDefault();
                moveActiveSearchResult(-1);
                return;
            }
            if (event.key !== 'Enter') return;
            event.preventDefault();
            const selected = activeSearchIndex >= 0 ? latestResults[activeSearchIndex] : latestResults[0];
            openTradingPage(selected?.code || searchBar.value.trim());
        });
        searchResults.addEventListener('mousedown', (event) => event.preventDefault());
        searchResults.addEventListener('click', (event) => {
            const item = event.target.closest('.search-result-item');
            if (item) openTradingPage(item.dataset.code);
        });
        document.addEventListener('click', (event) => {
            if (!searchModal.contains(event.target) && event.target !== searchBar && event.target !== searchClearButton) {
                searchModal.classList.remove('show');
            }
        });
    }

    allocationList?.addEventListener('click', (event) => {
        const row = event.target.closest('[data-code]');
        if (row) openTradingPage(row.dataset.code);
    });
    holdingList?.addEventListener('click', (event) => {
        const row = event.target.closest('[data-code]');
        if (row) openTradingPage(row.dataset.code);
    });
    assetListTabs.forEach((button) => {
        button.addEventListener('click', () => {
            if (button.dataset.assetListTab === 'pending') {
                loadPendingOrders();
                return;
            }
            if (latestPortfolioPayload) {
                renderPortfolio(latestPortfolioPayload);
            } else {
                loadPortfolio();
            }
        });
    });
    refreshButton?.addEventListener('click', loadPortfolio);

    loadPortfolio();
});
