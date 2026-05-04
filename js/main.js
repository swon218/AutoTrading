import { drawStockChart } from './chartRenderer.js';
import {
    getIndicatorDefinition,
    indicatorDefinitions,
    normalizeIndicatorValues,
} from './indicators/registry.js';

document.addEventListener('DOMContentLoaded', () => {
    const mainWrap = document.querySelector('.main_m');
    const mainTop = document.querySelector('.main_a');
    const mainBottom = document.querySelector('.main_b');
    const chartArea = document.querySelector('.chart_area');
    const sidebarToggle = document.getElementById('sidebarToggle');
    const appSidebar = document.getElementById('appSidebar');
    const COMPACT_LAYOUT_QUERY = '(max-width: 1100px)';
    const compactLayoutQuery = window.matchMedia(COMPACT_LAYOUT_QUERY);

    if (mainWrap && mainTop && mainBottom && chartArea) {
        mainWrap.dataset.layout = 'main_m';
        mainTop.dataset.section = 'main_a';
        mainBottom.dataset.section = 'main_b';
    }

    const profileBtn = document.getElementById('profileBtn');
    const profileMenu = document.getElementById('profileMenu');

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

    const updateSidebarToggleState = (isExpanded) => {
        if (!sidebarToggle) return;
        sidebarToggle.setAttribute('aria-expanded', String(isExpanded));
        sidebarToggle.setAttribute('aria-label', isExpanded ? '좌측 메뉴 접기' : '좌측 메뉴 펼치기');
    };

    const setCompactSidebarOpen = (isOpen) => {
        if (!appSidebar) return;
        document.body.classList.toggle('compact-sidebar-open', isOpen);
        appSidebar.classList.toggle('is-collapsed', !isOpen);
        updateSidebarToggleState(isOpen);
        window.setTimeout(() => {
            resetChartPointerState();
            if (!isOpen) requestChartRedraw();
        }, 60);
    };

    if (sidebarToggle && appSidebar) {
        sidebarToggle.addEventListener('click', () => {
            if (compactLayoutQuery.matches) {
                setCompactSidebarOpen(!document.body.classList.contains('compact-sidebar-open'));
                return;
            }

            document.body.classList.remove('compact-sidebar-open');
            const isCollapsed = appSidebar.classList.toggle('is-collapsed');
            updateSidebarToggleState(!isCollapsed);
            window.setTimeout(() => {
                resetChartPointerState();
                requestChartRedraw();
            }, 320);
        });
    }

    const searchBar = document.getElementById('searchBar');
    const searchClearButton = document.getElementById('searchClearButton');
    const searchModal = document.getElementById('searchModal');
    const searchResults = document.getElementById('searchResults');
    const chartCanvas = document.getElementById('stockChart');
    const chartStatus = document.getElementById('chartStatus');
    const chartIntervalButtons = Array.from(document.querySelectorAll('.chart-interval-btn'));
    const chartZoomIn = document.getElementById('chartZoomIn');
    const chartZoomOut = document.getElementById('chartZoomOut');

    const stockEls = {
        name: document.getElementById('stockName'),
        code: document.getElementById('stockCode'),
        price: document.getElementById('stockPrice'),
        change: document.getElementById('stockChange'),
        high: document.getElementById('stockHigh'),
        low: document.getElementById('stockLow'),
        volume: document.getElementById('stockVolume'),
    };
    const serverConnectionStatus = document.getElementById('serverConnectionStatus');
    const serverConnectionText = document.getElementById('serverConnectionText');
    const savedStrategySelect = document.getElementById('savedStrategySelect');
    const strategyNameInput = document.getElementById('strategyNameInput');
    const strategyNameMessage = document.getElementById('strategyNameMessage');
    const indicatorSearchInput = document.getElementById('indicatorSearchInput');
    const indicatorSearchDropdown = document.getElementById('indicatorSearchDropdown');
    const indicatorAddButton = document.getElementById('indicatorAddButton');
    const indicatorCards = document.getElementById('indicatorCards');
    const indicatorResetButton = document.getElementById('indicatorResetButton');
    const indicatorSaveButton = document.getElementById('indicatorSaveButton');

    let currentStockCode = '';
    let refreshTimer = null;
    let searchTimer = null;
    let latestResults = [];
    let activeSearchIndex = -1;
    const SEARCH_DRAFT_STORAGE_KEY = 'autotrading.stockSearchDraft';
    const DEFAULT_CHART_INTERVAL = '15';
    let currentChartInterval = DEFAULT_CHART_INTERVAL;
    let latestCandles = [];
    let visibleCandleCount = 90;
    let chartStartIndex = 0;
    let isChartDragging = false;
    let isPriceScaleDragging = false;
    let chartDragStartX = 0;
    let chartDragStartIndex = 0;
    let priceScaleDragStartY = 0;
    let priceScaleDragStartZoom = 1;
    let priceScaleZoom = 1;
    let chartHoverPoint = null;
    let chartRedrawFrame = null;
    let realtimeSource = null;
    let marketSessionTimer = null;
    let hasTodayChartCandle = false;
    let activeIndicators = [];
    let savedIndicatorStrategies = [];

    const formatNumber = (value) => {
        if (value === null || value === undefined || Number.isNaN(Number(value))) {
            return '-';
        }
        return Number(value).toLocaleString('ko-KR');
    };

    const cloneIndicatorFromDefinition = (definition) => {
        return {
            id: `${definition.key}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            key: definition.key,
            values: Object.fromEntries(definition.fields.map((field) => [field.key, field.value])),
        };
    };

    const getIndicatorFieldValue = (indicator, field) => {
        const values = normalizeIndicatorValues(indicator.key, indicator.values);
        return values[field.key] ?? field.value;
    };

    const getSavedStrategyDefaults = () => {
        return [
            {
                id: 'preset-1',
                name: '1번',
                indicators: [
                    { key: 'rsi', values: { period: 14, lower: 30, upper: 70 } },
                ],
            },
            {
                id: 'preset-2',
                name: '2번',
                indicators: [
                    { key: 'rsi', values: { period: 14, lower: 30, upper: 70 } },
                    { key: 'ma', values: { maType: 'sma', short: 5, long: 20 } },
                ],
            },
            {
                id: 'preset-a',
                name: 'A전략',
                indicators: [
                    { key: 'bollinger', values: { period: 20, deviation: 2 } },
                    { key: 'macd', values: { fast: 12, slow: 26, signal: 9 } },
                ],
            },
        ];
    };

    const loadSavedIndicatorStrategies = async () => {
        try {
            const response = await fetch('/api/indicator-strategies', { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const payload = await response.json();
            return payload.strategies?.length ? payload.strategies : getSavedStrategyDefaults();
        } catch {
            return getSavedStrategyDefaults();
        }
    };

    const createSavedIndicatorStrategy = async (strategy) => {
        const response = await fetch('/api/indicator-strategies', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify(strategy),
        });

        if (!response.ok) {
            const errorPayload = await response.json().catch(() => ({}));
            throw new Error(errorPayload.message || `HTTP ${response.status}`);
        }

        return response.json();
    };

    const updateSavedIndicatorStrategy = async (id, strategy) => {
        const response = await fetch(`/api/indicator-strategies/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify(strategy),
        });

        if (!response.ok) {
            const errorPayload = await response.json().catch(() => ({}));
            throw new Error(errorPayload.message || `HTTP ${response.status}`);
        }

        return response.json();
    };

    const renderSavedStrategyOptions = () => {
        if (!savedStrategySelect) return;

        savedStrategySelect.innerHTML = '<option value="">저장한 전략 불러오기</option>';
        savedIndicatorStrategies.forEach((strategy) => {
            const option = document.createElement('option');
            option.value = strategy.id;
            option.textContent = strategy.name;
            savedStrategySelect.appendChild(option);
        });
    };

    const setStrategyMessage = (message = '') => {
        if (!strategyNameMessage) return;
        strategyNameMessage.textContent = message;
    };

    const getSelectedStrategy = () => {
        return savedIndicatorStrategies.find((strategy) => strategy.id === savedStrategySelect?.value);
    };

    const getStrategyName = () => {
        return String(strategyNameInput?.value || '').trim();
    };

    const isDuplicateStrategyName = (name, currentId = '') => {
        const normalizeStrategyName = (value) => String(value || '').replace(/\s+/g, '').toLowerCase();
        const normalized = normalizeStrategyName(name);
        return savedIndicatorStrategies.some((strategy) => {
            return strategy.id !== currentId && normalizeStrategyName(strategy.name) === normalized;
        });
    };

    const getMatchingIndicatorDefinitions = (query = '') => {
        const normalized = String(query || '').trim().toLowerCase();
        if (!normalized) return indicatorDefinitions;

        return indicatorDefinitions.filter((definition) => {
            return definition.name.toLowerCase().includes(normalized)
                || definition.aliases.some((alias) => alias.toLowerCase().includes(normalized));
        });
    };

    const hideIndicatorDropdown = () => {
        indicatorSearchDropdown?.classList.add('hidden');
    };

    const renderIndicatorDropdown = () => {
        if (!indicatorSearchDropdown) return;

        const matches = getMatchingIndicatorDefinitions(indicatorSearchInput?.value);
        indicatorSearchDropdown.innerHTML = matches.length
            ? matches.map((definition) => {
                return `
                    <button type="button" class="indicator-search-option" data-indicator-key="${definition.key}">
                        <strong>${definition.name}</strong>
                        <span>${definition.description}</span>
                    </button>
                `;
            }).join('')
            : '<div class="indicator-empty">지원하는 보조지표가 없습니다.</div>';

        indicatorSearchDropdown.classList.remove('hidden');
    };

    const findIndicatorDefinition = (query) => {
        const normalized = String(query || '').trim().toLowerCase();
        if (!normalized) return null;

        return indicatorDefinitions.find((definition) => {
            return definition.name.toLowerCase().includes(normalized)
                || definition.aliases.some((alias) => alias.toLowerCase().includes(normalized));
        });
    };

    const renderIndicatorCards = () => {
        if (!indicatorCards) return;

        if (!activeIndicators.length) {
            indicatorCards.innerHTML = '<div class="indicator-empty">보조지표를 검색해서 추가하세요.</div>';
            return;
        }

        indicatorCards.innerHTML = activeIndicators
            .map((indicator) => {
                const definition = getIndicatorDefinition(indicator.key);
                if (!definition) return '';

                const fields = definition.fields.map((field) => {
                    const value = getIndicatorFieldValue(indicator, field);
                    if (field.type === 'select') {
                        const options = field.options
                            .map((option) => {
                                const selected = String(option.value) === String(value) ? 'selected' : '';
                                return `<option value="${option.value}" ${selected}>${option.label}</option>`;
                            })
                            .join('');
                        return `
                            <div class="indicator-field">
                                <label>${field.label}</label>
                                <select data-indicator-id="${indicator.id}" data-field-key="${field.key}">${options}</select>
                            </div>
                        `;
                    }

                    return `
                        <div class="indicator-field">
                            <label>${field.label}</label>
                            <input type="number" value="${value}" data-indicator-id="${indicator.id}" data-field-key="${field.key}">
                        </div>
                    `;
                }).join('');

                return `
                    <div class="indicator-card" data-indicator-id="${indicator.id}">
                        <div class="indicator-card-header">
                            <div>
                                <div class="indicator-card-title">${definition.name}</div>
                                <div class="indicator-card-desc">${definition.description}</div>
                            </div>
                            <button type="button" class="indicator-remove-button" data-remove-indicator="${indicator.id}" title="보조지표 삭제">x</button>
                        </div>
                        <div class="indicator-field-grid">${fields}</div>
                    </div>
                `;
            })
            .join('');
    };

    const setActiveIndicatorsFromStrategy = (strategy) => {
        if (strategyNameInput) strategyNameInput.value = strategy.name;
        setStrategyMessage('');
        activeIndicators = strategy.indicators.map((indicator) => {
            return {
                id: `${indicator.key}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                key: indicator.key,
                values: normalizeIndicatorValues(indicator.key, indicator.values),
            };
        });
        renderIndicatorCards();
        redrawLatestChart();
    };

    const addIndicatorByQuery = () => {
        const definition = findIndicatorDefinition(indicatorSearchInput?.value);
        if (!definition || !indicatorSearchInput) return;

        activeIndicators.push(cloneIndicatorFromDefinition(definition));
        indicatorSearchInput.value = '';
        hideIndicatorDropdown();
        renderIndicatorCards();
        redrawLatestChart();
    };

    const addIndicatorByKey = (key) => {
        const definition = getIndicatorDefinition(key);
        if (!definition) return;

        activeIndicators.push(cloneIndicatorFromDefinition(definition));
        if (indicatorSearchInput) indicatorSearchInput.value = '';
        hideIndicatorDropdown();
        renderIndicatorCards();
        redrawLatestChart();
    };

    const initIndicatorStrategyPanel = async () => {
        if (!savedStrategySelect || !indicatorCards) return;

        savedIndicatorStrategies = await loadSavedIndicatorStrategies();
        renderSavedStrategyOptions();
        renderIndicatorCards();

        savedStrategySelect.addEventListener('change', () => {
            const strategy = savedIndicatorStrategies.find((item) => item.id === savedStrategySelect.value);
            if (strategy) {
                setActiveIndicatorsFromStrategy(strategy);
            } else {
                activeIndicators = [];
                if (strategyNameInput) strategyNameInput.value = '';
                setStrategyMessage('');
                renderIndicatorCards();
                redrawLatestChart();
            }
        });

        indicatorAddButton?.addEventListener('click', addIndicatorByQuery);
        indicatorSearchInput?.addEventListener('focus', renderIndicatorDropdown);
        indicatorSearchInput?.addEventListener('input', renderIndicatorDropdown);
        indicatorSearchInput?.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            addIndicatorByQuery();
        });

        indicatorSearchDropdown?.addEventListener('mousedown', (event) => {
            event.preventDefault();
            const option = event.target.closest('[data-indicator-key]');
            if (!option) return;
            addIndicatorByKey(option.dataset.indicatorKey);
        });

        document.addEventListener('click', (event) => {
            if (!indicatorSearchDropdown || !indicatorSearchInput) return;
            if (indicatorSearchDropdown.contains(event.target) || event.target === indicatorSearchInput) return;
            hideIndicatorDropdown();
        });

        indicatorCards.addEventListener('click', (event) => {
            const removeButton = event.target.closest('[data-remove-indicator]');
            if (!removeButton) return;

            activeIndicators = activeIndicators.filter((indicator) => indicator.id !== removeButton.dataset.removeIndicator);
            renderIndicatorCards();
            redrawLatestChart();
        });

        indicatorCards.addEventListener('input', (event) => {
            const target = event.target;
            const indicatorId = target.dataset.indicatorId;
            const fieldKey = target.dataset.fieldKey;
            if (!indicatorId || !fieldKey) return;

            const indicator = activeIndicators.find((item) => item.id === indicatorId);
            if (!indicator) return;

            indicator.values[fieldKey] = target.type === 'number' ? Number(target.value) : target.value;
            redrawLatestChart();
        });

        indicatorResetButton?.addEventListener('click', () => {
            activeIndicators = [];
            if (savedStrategySelect) savedStrategySelect.value = '';
            if (strategyNameInput) strategyNameInput.value = '';
            setStrategyMessage('');
            renderIndicatorCards();
            redrawLatestChart();
        });

        indicatorSaveButton?.addEventListener('click', () => {
            if (!activeIndicators.length) return;

            const selectedStrategyId = savedStrategySelect?.value || '';
            const selectedStrategy = getSelectedStrategy();
            const strategyName = getStrategyName();
            if (!strategyName) {
                setStrategyMessage('전략 이름을 입력하세요.');
                return;
            }

            if (isDuplicateStrategyName(strategyName, selectedStrategyId)) {
                setStrategyMessage('이미 존재하는 전략명입니다.');
                return;
            }

            const nextIndex = savedIndicatorStrategies.length + 1;
            const strategy = {
                name: strategyName || selectedStrategy?.name || `새 전략 ${nextIndex}`,
                indicators: activeIndicators.map((indicator) => ({
                    key: indicator.key,
                    values: { ...indicator.values },
                })),
            };

            const canUpdateSelectedStrategy = selectedStrategy && !String(selectedStrategy.id).startsWith('preset-');
            const saveRequest = canUpdateSelectedStrategy
                ? updateSavedIndicatorStrategy(selectedStrategy.id, strategy)
                : createSavedIndicatorStrategy(strategy);

            saveRequest
                .then((savedStrategy) => {
                    const existingIndex = savedIndicatorStrategies.findIndex((item) => item.id === savedStrategy.id);
                    if (existingIndex >= 0) {
                        savedIndicatorStrategies[existingIndex] = savedStrategy;
                    } else {
                        savedIndicatorStrategies.push(savedStrategy);
                    }
                    renderSavedStrategyOptions();
                    savedStrategySelect.value = savedStrategy.id;
                    if (strategyNameInput) strategyNameInput.value = savedStrategy.name;
                    setStrategyMessage('');
                })
                .catch((error) => {
                    console.error('Indicator strategy save failed.', error);
                    if (error.message === 'Strategy name already exists.') {
                        setStrategyMessage('이미 존재하는 전략명입니다.');
                    }
                });
        });
    };

    const getUrlParams = () => {
        return new URLSearchParams(window.location.search);
    };

    const updateChartUrl = (code = currentStockCode, interval = currentChartInterval) => {
        if (!code) return;

        const params = new URLSearchParams();
        params.set('code', code);
        if (interval && interval !== DEFAULT_CHART_INTERVAL) {
            params.set('interval', interval);
        }

        const nextUrl = `${window.location.pathname}?${params.toString()}`;
        window.history.replaceState(null, '', nextUrl);
    };

    const setDirectionClass = (element, direction) => {
        if (!element) return;
        element.classList.remove('text-up', 'text-down', 'text-slate-300');

        if (direction === 'up') {
            element.classList.add('text-up');
        } else if (direction === 'down') {
            element.classList.add('text-down');
        } else {
            element.classList.add('text-slate-300');
        }
    };

    const setMarketSessionStatus = (isRegularMarket, hasCurrentChartData = hasTodayChartCandle) => {
        if (!serverConnectionStatus || !serverConnectionText) return;

        const isOpen = isRegularMarket && hasCurrentChartData;
        serverConnectionStatus.classList.toggle('is-connected', isOpen);
        serverConnectionStatus.classList.toggle('is-disconnected', !isOpen);

        serverConnectionText.textContent = isOpen ? '정규장' : '정규장종료';
    };

    const getKoreaMarketTime = () => {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Seoul',
            weekday: 'short',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        }).formatToParts(new Date());
        const pick = (type) => parts.find((part) => part.type === type)?.value || '';

        return {
            weekday: pick('weekday'),
            hour: Number(pick('hour')),
            minute: Number(pick('minute')),
        };
    };

    const isRegularMarketTime = () => {
        const { weekday, hour, minute } = getKoreaMarketTime();
        if (['Sat', 'Sun'].includes(weekday)) return false;

        const minutes = hour * 60 + minute;
        const marketOpen = 9 * 60;
        const marketClose = 15 * 60 + 30;
        return minutes >= marketOpen && minutes < marketClose;
    };

    const getKoreaDateString = (date = new Date()) => {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Seoul',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).formatToParts(date);
        const pick = (type) => parts.find((part) => part.type === type)?.value || '';
        return `${pick('year')}-${pick('month')}-${pick('day')}`;
    };

    const hasTodayCandle = (candles) => {
        const today = getKoreaDateString();
        return candles.some((candle) => String(candle.time || '').slice(0, 10) === today);
    };

    const updateMarketSessionStatus = () => {
        setMarketSessionStatus(isRegularMarketTime(), hasTodayChartCandle);
    };

    const setTodayChartCandleStatus = (available) => {
        hasTodayChartCandle = available;
        updateMarketSessionStatus();
    };

    const startMarketSessionStatusTimer = () => {
        updateMarketSessionStatus();
        if (marketSessionTimer) clearInterval(marketSessionTimer);
        marketSessionTimer = setInterval(updateMarketSessionStatus, 30000);
    };

    const setLoadingView = (query) => {
        if (stockEls.name) stockEls.name.textContent = query || '-';
        if (stockEls.code && !currentStockCode) stockEls.code.textContent = '-';
        if (stockEls.price) stockEls.price.textContent = '-';
        if (stockEls.change) stockEls.change.textContent = '-';
        if (stockEls.high) stockEls.high.textContent = '-';
        if (stockEls.low) stockEls.low.textContent = '-';
        if (stockEls.volume) stockEls.volume.textContent = '-';

        setDirectionClass(stockEls.price, 'flat');
        setDirectionClass(stockEls.change, 'flat');
        setDirectionClass(stockEls.high, 'flat');
        setDirectionClass(stockEls.low, 'flat');
    };

    const updateStockView = (stock) => {
        const direction = stock.direction || 'flat';
        const sign = direction === 'up' ? '\u25B2' : direction === 'down' ? '\u25BC' : '-';

        currentStockCode = stock.code || currentStockCode;

        if (stockEls.name) stockEls.name.textContent = stock.name || '-';
        if (stockEls.code) stockEls.code.textContent = stock.code || '-';
        if (stockEls.price) stockEls.price.textContent = formatNumber(stock.price);
        if (stockEls.change) {
            stockEls.change.textContent = `${sign} ${formatNumber(Math.abs(stock.change || 0))} (${Number(stock.changeRate || 0).toFixed(2)}%)`;
        }
        if (stockEls.high) stockEls.high.textContent = formatNumber(stock.high);
        if (stockEls.low) stockEls.low.textContent = formatNumber(stock.low);
        if (stockEls.volume) stockEls.volume.textContent = formatNumber(stock.volume);

        setDirectionClass(stockEls.price, direction);
        setDirectionClass(stockEls.change, direction);
        setDirectionClass(stockEls.high, 'up');
        setDirectionClass(stockEls.low, 'down');
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
                    <button class="search-result-item${activeClass}" type="button" data-code="${stock.code}" data-index="${index}">
                        <span class="search-result-name">${stock.name}</span>
                        <span class="search-result-code">${stock.code}</span>
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

    const moveActiveSearchResult = (direction) => {
        if (!latestResults.length) return;
        activeSearchIndex = (activeSearchIndex + direction + latestResults.length) % latestResults.length;
        updateActiveSearchResult();
    };

    const saveSearchDraft = (value) => {
        try {
            sessionStorage.setItem(SEARCH_DRAFT_STORAGE_KEY, value);
        } catch {
            // Ignore private-mode or storage quota errors; the live input still keeps its value.
        }
    };

    const clearSearchDraft = () => {
        try {
            sessionStorage.removeItem(SEARCH_DRAFT_STORAGE_KEY);
        } catch {
            // Ignore storage errors.
        }
    };

    const restoreSearchDraft = () => {
        if (!searchBar) return;

        try {
            const draft = sessionStorage.getItem(SEARCH_DRAFT_STORAGE_KEY) || '';
            if (draft) {
                searchBar.value = draft;
            }
        } catch {
            // Ignore storage errors.
        }
    };

    const updateSearchClearButton = () => {
        if (!searchClearButton || !searchBar) return;
        searchClearButton.classList.toggle('show', Boolean(searchBar.value));
    };

    const setChartStatus = (message) => {
        if (!chartStatus) return;
        chartStatus.textContent = message;
        chartStatus.classList.toggle('hidden', !message);
    };

    const resizeChartCanvas = () => {
        if (!chartCanvas) return null;

        const rect = chartCanvas.getBoundingClientRect();
        const ratio = window.devicePixelRatio || 1;
        if (rect.width < 2 || rect.height < 2) return null;

        const width = Math.max(1, Math.floor(rect.width));
        const height = Math.max(1, Math.floor(rect.height));

        if (chartCanvas.width !== Math.floor(width * ratio) || chartCanvas.height !== Math.floor(height * ratio)) {
            chartCanvas.width = Math.floor(width * ratio);
            chartCanvas.height = Math.floor(height * ratio);
        }

        const ctx = chartCanvas.getContext('2d');
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        return { ctx, width, height };
    };

    const clampChartWindow = () => {
        const maxStart = Math.max(0, latestCandles.length - visibleCandleCount);
        chartStartIndex = Math.max(0, Math.min(maxStart, chartStartIndex));
    };

    const snapChartToLatest = () => {
        chartStartIndex = Math.max(0, latestCandles.length - visibleCandleCount);
    };

    const isViewingLatest = () => {
        return chartStartIndex >= Math.max(0, latestCandles.length - visibleCandleCount);
    };

    const getVisibleCandles = () => {
        clampChartWindow();
        return latestCandles.slice(chartStartIndex, chartStartIndex + visibleCandleCount);
    };

    const redrawLatestChart = () => {
        chartRedrawFrame = null;
        if (document.body.classList.contains('compact-sidebar-open')) return;
        drawStockChart({
            chartCanvas,
            resizeChartCanvas,
            candles: getVisibleCandles(),
            activeIndicators,
            chartHoverPoint,
            currentChartInterval,
            priceScaleZoom,
            formatChartTime,
            setChartStatus,
        });
    };

    const requestChartRedraw = () => {
        if (document.body.classList.contains('compact-sidebar-open')) return;
        if (chartRedrawFrame) return;
        chartRedrawFrame = window.requestAnimationFrame(redrawLatestChart);
    };

    const resetChartPointerState = () => {
        isChartDragging = false;
        isPriceScaleDragging = false;
        chartHoverPoint = null;
        if (chartCanvas) {
            chartCanvas.classList.remove('dragging');
            chartCanvas.style.cursor = '';
        }
    };

    const isInPriceAxisArea = (x, width, y = 0, height = Infinity) => {
        const priceAxisWidth = 64;
        const priceAreaBottomLimit = height * 0.72;
        return x >= width - priceAxisWidth && y <= priceAreaBottomLimit;
    };

    const zoomChart = (direction) => {
        if (!latestCandles.length) return;

        const minCandles = 20;
        const maxCandles = Math.max(20, latestCandles.length);
        const zoomFactor = direction === 'in' ? 0.8 : 1.25;

        visibleCandleCount = Math.round(visibleCandleCount * zoomFactor);
        visibleCandleCount = Math.max(minCandles, Math.min(maxCandles, visibleCandleCount));
        snapChartToLatest();
        redrawLatestChart();
    };

    const formatChartTime = (time, interval = currentChartInterval, compact = false) => {
        if (!time) return '';
        const datePart = time.slice(0, 10);
        if (['day', 'week', 'month'].includes(interval)) {
            return compact ? datePart.slice(5) : datePart;
        }

        if (!time.includes('T')) return time;
        return compact ? time.slice(5, 16).replace('T', ' ') : time.slice(0, 16).replace('T', ' ');
    };

    const fetchChart = async (code = currentStockCode) => {
        if (!code) return;

        try {
            setChartStatus('李⑦듃 ?곗씠?곕? 遺덈윭?ㅻ뒗 以?..');
            const response = await fetch(`/api/chart/${encodeURIComponent(code)}?interval=${encodeURIComponent(currentChartInterval)}`, {
                cache: 'no-store',
            });

            if (!response.ok) {
                const errorPayload = await response.json().catch(() => ({}));
                throw new Error(errorPayload.message || `HTTP ${response.status}`);
            }

            const payload = await response.json();
            latestCandles = payload.candles || [];
            setTodayChartCandleStatus(hasTodayCandle(latestCandles));
            visibleCandleCount = Math.min(Math.max(60, visibleCandleCount), Math.max(60, latestCandles.length));
            snapChartToLatest();
            redrawLatestChart();
        } catch (error) {
            console.error('Chart request failed.', error);
            setTodayChartCandleStatus(false);
            latestCandles = [];
            redrawLatestChart();
            setChartStatus('李⑦듃 ?곗씠?곕? 遺덈윭?ㅼ? 紐삵뻽?듬땲??');
        }
    };

    const setActiveIntervalButton = () => {
        chartIntervalButtons.forEach((button) => {
            const active = button.dataset.interval === currentChartInterval;
            button.classList.toggle('text-emerald-400', active);
            button.classList.toggle('font-medium', active);
            button.classList.toggle('border-b-2', active);
            button.classList.toggle('border-emerald-400', active);
            button.classList.toggle('text-slate-400', !active);
        });
    };

    const bucketTime = (isoTime, interval) => {
        const formatLocalDate = (date) => {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        if (interval === 'day') {
            return isoTime.slice(0, 10);
        }

        const date = new Date(isoTime);
        if (!Number.isFinite(date.getTime())) {
            return isoTime;
        }

        if (interval === 'week') {
            const monday = new Date(date);
            const day = monday.getDay() || 7;
            monday.setDate(monday.getDate() - day + 1);
            return formatLocalDate(monday);
        }

        if (interval === 'month') {
            const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
            return formatLocalDate(monthStart);
        }

        const minutes = Number(interval);
        if (!Number.isFinite(date.getTime()) || !Number.isFinite(minutes)) {
            return isoTime;
        }

        date.setSeconds(0, 0);

        if (minutes === 120) {
            const marketOpenMinutes = 9 * 60;
            const elapsedMinutes = Math.max(0, (date.getHours() * 60 + date.getMinutes()) - marketOpenMinutes);
            const bucketStartMinutes = marketOpenMinutes + Math.floor(elapsedMinutes / minutes) * minutes;
            date.setHours(Math.floor(bucketStartMinutes / 60), bucketStartMinutes % 60, 0, 0);
        } else {
            date.setMinutes(Math.floor(date.getMinutes() / minutes) * minutes);
        }

        return date.toISOString();
    };

    const applyRealtimeTickToChart = (tick) => {
        if (!latestCandles.length || !tick.price) return;

        const keepLatest = isViewingLatest();
        const nextTime = bucketTime(tick.time, currentChartInterval);
        const last = latestCandles[latestCandles.length - 1];

        if (last.time === nextTime) {
            last.high = Math.max(last.high, tick.price);
            last.low = Math.min(last.low, tick.price);
            last.close = tick.price;
            if (tick.tradeVolume) {
                last.volume = (last.volume || 0) + tick.tradeVolume;
            }
        } else {
            latestCandles.push({
                time: nextTime,
                open: last.close,
                high: Math.max(last.close, tick.price),
                low: Math.min(last.close, tick.price),
                close: tick.price,
                volume: tick.tradeVolume || 0,
            });

            latestCandles = latestCandles.slice(-180);
        }

        if (keepLatest) {
            snapChartToLatest();
        } else {
            clampChartWindow();
        }
        redrawLatestChart();
    };

    const applyRealtimeTickToQuote = (tick) => {
        if (tick.code && tick.code !== currentStockCode) return;

        if (stockEls.price) stockEls.price.textContent = formatNumber(tick.price);
        if (stockEls.change && tick.change !== null) {
            const sign = tick.direction === 'up' ? '\u25B2' : tick.direction === 'down' ? '\u25BC' : '-';
            stockEls.change.textContent = `${sign} ${formatNumber(Math.abs(tick.change || 0))} (${Number(tick.changeRate || 0).toFixed(2)}%)`;
        }
        if (stockEls.high && tick.high !== null) stockEls.high.textContent = formatNumber(tick.high);
        if (stockEls.low && tick.low !== null) stockEls.low.textContent = formatNumber(tick.low);
        if (stockEls.volume && tick.volume !== null) stockEls.volume.textContent = formatNumber(tick.volume);

        setDirectionClass(stockEls.price, tick.direction || 'flat');
        setDirectionClass(stockEls.change, tick.direction || 'flat');
    };

    const startRealtime = (code) => {
        if (!code) return;

        if (realtimeSource) {
            realtimeSource.close();
            realtimeSource = null;
        }

        realtimeSource = new EventSource(`/api/realtime/${encodeURIComponent(code)}`);

        realtimeSource.addEventListener('tick', (event) => {
            const tick = JSON.parse(event.data);
            applyRealtimeTickToQuote(tick);
            applyRealtimeTickToChart(tick);
            setTodayChartCandleStatus(hasTodayCandle(latestCandles));
        });

        realtimeSource.addEventListener('error', () => {
            console.warn('Realtime stream disconnected.');
        });
    };

    const fetchStock = async (query, options = {}) => {
        const { closeSearch = false, showLoading = true } = options;
        const keyword = String(query || '').trim();
        if (!keyword) return;

        try {
            if (showLoading) {
                setLoadingView(keyword);
            }
            const response = await fetch(`/api/stock/${encodeURIComponent(keyword)}`, {
                cache: 'no-store',
            });

            if (!response.ok) {
                const errorPayload = await response.json().catch(() => ({}));
                throw new Error(errorPayload.message || `HTTP ${response.status}`);
            }

            const stock = await response.json();
            updateStockView(stock);

            if (closeSearch && searchModal) {
                searchModal.classList.remove('show');
            }
            return stock;
        } catch (error) {
            console.error('Stock request failed.', error);
            return null;
        }
    };

    const startAutoRefresh = () => {
        if (refreshTimer) {
            clearInterval(refreshTimer);
        }

        refreshTimer = setInterval(() => {
            if (currentStockCode) {
                fetchStock(currentStockCode, {
                    closeSearch: false,
                    showLoading: false,
                });
            }
        }, 60000);
    };

    const selectStock = async (query) => {
        const stock = await fetchStock(query, {
            closeSearch: true,
            showLoading: true,
        });
        if (!stock) return;

        updateChartUrl(stock.code);
        await fetchChart(stock.code);
        startRealtime(stock.code);
        if (searchBar) {
            searchBar.value = '';
        }
        clearSearchDraft();
        updateSearchClearButton();
        renderSearchMessage('종목명 또는 종목코드를 입력하세요.');
        startAutoRefresh();
    };

    const searchStocks = async (query) => {
        const keyword = String(query || '').trim();

        if (!keyword) {
            latestResults = [];
            renderSearchMessage('종목명 또는 종목코드를 입력하세요.');
            return;
        }

        if (/^\d{6}$/.test(keyword)) {
            renderSearchResults([{ code: keyword, name: '종목코드 직접 조회' }]);
            return;
        }

        try {
            renderSearchMessage('검색 중...');
            const response = await fetch(`/api/search?q=${encodeURIComponent(keyword)}`, {
                cache: 'no-store',
            });

            if (!response.ok) {
                const errorPayload = await response.json().catch(() => ({}));
                throw new Error(errorPayload.message || `HTTP ${response.status}`);
            }

            const payload = await response.json();
            renderSearchResults(payload.results || []);
        } catch (error) {
            console.error('Search request failed.', error);
            renderSearchMessage('검색 중 오류가 발생했습니다.');
        }
    };

    if (searchBar && searchModal && searchResults) {
        restoreSearchDraft();
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
            saveSearchDraft(searchBar.value);
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
            clearSearchDraft();
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
                moveActiveSearchResult(1);
                return;
            }

            if (event.key === 'ArrowUp') {
                event.preventDefault();
                clearTimeout(searchTimer);
                searchModal.classList.add('show');
                moveActiveSearchResult(-1);
                return;
            }

            if (event.key !== 'Enter') return;

            event.preventDefault();
            const keyword = searchBar.value.trim();
            const selected = activeSearchIndex >= 0 ? latestResults[activeSearchIndex] : latestResults[0];
            const target = selected?.code || keyword;
            selectStock(target);
        });

        searchResults.addEventListener('click', (event) => {
            const button = event.target.closest('[data-code]');
            if (!button) return;

            activeSearchIndex = Number(button.dataset.index || -1);
            selectStock(button.dataset.code);
        });

        document.addEventListener('click', (event) => {
            if (!searchModal.contains(event.target) && event.target !== searchBar) {
                searchModal.classList.remove('show');
            }
        });
    }

    chartIntervalButtons.forEach((button) => {
        button.addEventListener('click', () => {
            currentChartInterval = button.dataset.interval || '1';
            setActiveIntervalButton();
            updateChartUrl(currentStockCode);
            fetchChart(currentStockCode);
            if (currentStockCode) {
                startRealtime(currentStockCode);
            }
        });
    });

    if (chartCanvas) {
        chartCanvas.addEventListener('wheel', (event) => {
            event.preventDefault();
            zoomChart(event.deltaY < 0 ? 'in' : 'out');
        }, { passive: false });

        chartCanvas.addEventListener('mousemove', (event) => {
            const rect = chartCanvas.getBoundingClientRect();
            const mouseX = event.clientX - rect.left;
            const mouseY = event.clientY - rect.top;

            if (!isChartDragging && !isPriceScaleDragging) {
                chartCanvas.style.cursor = isInPriceAxisArea(mouseX, rect.width, mouseY, rect.height) ? 'ns-resize' : 'grab';
            }

            if (isChartDragging || isPriceScaleDragging) return;

            chartHoverPoint = {
                x: mouseX,
                y: mouseY,
            };
            requestChartRedraw();
        });

        chartCanvas.addEventListener('mouseleave', () => {
            if (isPriceScaleDragging || isChartDragging) return;
            chartHoverPoint = null;
            chartCanvas.style.cursor = '';
            requestChartRedraw();
        });

        chartCanvas.addEventListener('mousedown', (event) => {
            if (event.button !== 0 || !latestCandles.length) return;

            const rect = chartCanvas.getBoundingClientRect();
            const mouseX = event.clientX - rect.left;
            const mouseY = event.clientY - rect.top;
            chartHoverPoint = null;

            if (isInPriceAxisArea(mouseX, rect.width, mouseY, rect.height)) {
                isPriceScaleDragging = true;
                priceScaleDragStartY = event.clientY;
                priceScaleDragStartZoom = priceScaleZoom;
                chartCanvas.style.cursor = 'ns-resize';
                return;
            }

            isChartDragging = true;
            chartDragStartX = event.clientX;
            chartDragStartIndex = chartStartIndex;
            chartCanvas.classList.add('dragging');
        });

        window.addEventListener('mousemove', (event) => {
            if (isPriceScaleDragging) {
                const movedY = event.clientY - priceScaleDragStartY;
                const nextZoom = priceScaleDragStartZoom * Math.exp(-movedY / 180);
                priceScaleZoom = Math.max(0.25, Math.min(8, nextZoom));
                requestChartRedraw();
                return;
            }

            if (!isChartDragging || !chartCanvas) return;

            const rect = chartCanvas.getBoundingClientRect();
            const candleWidth = Math.max(1, rect.width / Math.max(1, visibleCandleCount));
            const movedCandles = Math.round((event.clientX - chartDragStartX) / candleWidth);

            chartStartIndex = chartDragStartIndex - movedCandles;
            clampChartWindow();
            requestChartRedraw();
        });

        window.addEventListener('mouseup', () => {
            if (isPriceScaleDragging) {
                isPriceScaleDragging = false;
                if (chartCanvas) chartCanvas.style.cursor = '';
                return;
            }

            if (!isChartDragging) return;

            isChartDragging = false;
            chartCanvas.classList.remove('dragging');
        });
    }

    if (chartZoomIn) {
        chartZoomIn.addEventListener('click', () => zoomChart('in'));
    }

    if (chartZoomOut) {
        chartZoomOut.addEventListener('click', () => zoomChart('out'));
    }

    compactLayoutQuery.addEventListener('change', () => {
        if (compactLayoutQuery.matches) {
            setCompactSidebarOpen(false);
        } else {
            document.body.classList.remove('compact-sidebar-open');
            updateSidebarToggleState(!appSidebar?.classList.contains('is-collapsed'));
        }
        resetChartPointerState();
        requestChartRedraw();
    });

    if (compactLayoutQuery.matches) {
        setCompactSidebarOpen(false);
    } else {
        updateSidebarToggleState(!appSidebar?.classList.contains('is-collapsed'));
    }

    if (window.ResizeObserver && chartArea) {
        const chartResizeObserver = new ResizeObserver(() => {
            resetChartPointerState();
            requestChartRedraw();
        });
        chartResizeObserver.observe(chartArea);
    }

    window.addEventListener('resize', () => {
        resetChartPointerState();
        requestChartRedraw();
    });

    startMarketSessionStatusTimer();
    setActiveIntervalButton();
    initIndicatorStrategyPanel();
    redrawLatestChart();

    const urlParams = getUrlParams();
    const initialCode = urlParams.get('code');
    const initialInterval = urlParams.get('interval');

    if (['1', '5', '15', '60', '120', 'day', 'week', 'month'].includes(initialInterval)) {
        currentChartInterval = initialInterval;
        setActiveIntervalButton();
    }

    if (initialCode) {
        fetchStock(initialCode, {
            closeSearch: false,
            showLoading: true,
        }).then((stock) => {
            if (!stock) return;
            updateChartUrl(stock.code);
            fetchChart(stock.code);
            startRealtime(stock.code);
            startAutoRefresh();
        });
    }
});

