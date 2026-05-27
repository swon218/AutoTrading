import { drawStockChart } from './chartRenderer.js';
import {
    getIndicatorDefinition,
    indicatorDefinitions,
    normalizeIndicatorValues,
} from './indicators/registry.js';
import { authFetch, createAuthenticatedEventSource } from './apiClient.js';

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
    const availableChartIntervals = chartIntervalButtons.map((button) => button.dataset.interval).filter(Boolean);
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
    const chartPeriodStartInput = document.getElementById('chartPeriodStartInput');
    const chartPeriodEndInput = document.getElementById('chartPeriodEndInput');
    const chartPeriodApplyButton = document.getElementById('chartPeriodApplyButton');
    const chartPeriodResetButton = document.getElementById('chartPeriodResetButton');
    const chartPeriodMessage = document.getElementById('chartPeriodMessage');
    const chartPeriodFields = Array.from(document.querySelectorAll('[data-chart-period-field]'));
    const chartPeriodCalendarButtons = Array.from(document.querySelectorAll('[data-chart-period-calendar]'));
    const indicatorSearchInput = document.getElementById('indicatorSearchInput');
    const indicatorSearchDropdown = document.getElementById('indicatorSearchDropdown');
    const indicatorAddButton = document.getElementById('indicatorAddButton');
    const indicatorCards = document.getElementById('indicatorCards');
    const indicatorResetButton = document.getElementById('indicatorResetButton');
    const indicatorDeleteButton = document.getElementById('indicatorDeleteButton');
    const indicatorSaveButton = document.getElementById('indicatorSaveButton');
    const rightPanelTabs = document.querySelectorAll('[data-panel-tab]');
    const indicatorPanel = document.getElementById('indicatorPanel');
    const orderPanel = document.getElementById('orderPanel');
    const periodPanel = document.getElementById('periodPanel');
    const orderForm = document.getElementById('orderForm');
    const orderActionButtons = document.querySelectorAll('[data-order-action]');
    const orderPriceButtons = document.querySelectorAll('[data-price-mode]');
    const orderPriceStepButtons = document.querySelectorAll('.order-price-step-button');
    const orderPriceInput = document.getElementById('orderPriceInput');
    const orderQuantityInput = document.getElementById('orderQuantityInput');
    const orderTotalInput = document.getElementById('orderTotalInput');
    const orderAvailableAmount = document.getElementById('orderAvailableAmount');
    const orderHoldingRow = document.getElementById('orderHoldingRow');
    const orderHoldingPrice = document.getElementById('orderHoldingPrice');
    const orderHoldingQuantity = document.getElementById('orderHoldingQuantity');
    const pendingOrdersPanel = document.getElementById('pendingOrdersPanel');
    const pendingOrdersList = document.getElementById('pendingOrdersList');
    const orderMessage = document.getElementById('orderMessage');
    const orderSubmitButton = document.getElementById('orderSubmitButton');

    let currentStockCode = '';
    let refreshTimer = null;
    let searchTimer = null;
    let latestResults = [];
    let activeSearchIndex = -1;
    const SEARCH_DRAFT_STORAGE_KEY = 'autotrading.stockSearchDraft';
    const isStaticStrategyChart = document.body.dataset.chartMode === 'strategy';
    const DEFAULT_CHART_INTERVAL = document.body.dataset.defaultChartInterval || '15';
    const chartHistoryYears = Number(document.body.dataset.chartYears) || 0;
    const chartCandleLimit = Number(document.body.dataset.chartLimit) || 0;
    let currentChartInterval = DEFAULT_CHART_INTERVAL;
    let latestCandles = [];
    let latestCandlesInterval = null;
    let visibleCandleCount = 90;
    let chartStartIndex = 0;
    let chartRequestId = 0;
    let chartRetryTimer = null;
    let isChartDragging = false;
    let isPriceScaleDragging = false;
    let chartDragStartX = 0;
    let chartDragStartIndex = 0;
    let priceScaleDragStartY = 0;
    let priceScaleDragStartZoom = 1;
    let priceScaleZoom = 1;
    let lowerIndicatorScrollOffset = 0;
    let latestChartLayout = null;
    let chartHoverPoint = null;
    let chartRedrawFrame = null;
    let realtimeSource = null;
    let marketSessionTimer = null;
    let apiHealthTimer = null;
    let isApiServerAvailable = true;
    let hasTodayChartCandle = false;
    let activeIndicators = [];
    let savedIndicatorStrategies = [];
    let currentOrderAction = 'buy';
    let currentOrderPriceMode = 'limit';
    let latestStockPrice = 0;
    let orderMessageTimer = null;
    let hasUserEditedOrderPrice = false;
    let orderableCashTimer = null;
    let pendingOrdersTimer = null;
    let latestSellableQuantity = 0;
    let holdingRequestId = 0;

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

    const isIndicatorActive = (key) => {
        return activeIndicators.some((indicator) => indicator.key === key);
    };

    const dedupeIndicatorsByKey = (indicators = []) => {
        const seenKeys = new Set();
        return indicators.filter((indicator) => {
            if (!indicator?.key || seenKeys.has(indicator.key)) return false;
            seenKeys.add(indicator.key);
            return true;
        });
    };

    const setRightPanel = (panelName = 'indicator') => {
        const panels = {
            indicator: indicatorPanel,
            order: orderPanel,
            period: periodPanel,
        };
        const selectedPanel = panels[panelName] ? panelName : 'indicator';
        const isOrderPanel = selectedPanel === 'order';

        Object.entries(panels).forEach(([name, panel]) => {
            panel?.classList.toggle('hidden', name !== selectedPanel);
        });

        rightPanelTabs.forEach((button) => {
            const isActive = button.dataset.panelTab === selectedPanel;
            button.classList.toggle('is-active', isActive);
            button.setAttribute('aria-selected', String(isActive));
        });

        if (isOrderPanel) {
            fetchOrderableCash();
        }
    };

    rightPanelTabs.forEach((button) => {
        button.addEventListener('click', () => {
            setRightPanel(button.dataset.panelTab);
        });
    });

    const setChartPeriodMessage = (message = '', type = 'info') => {
        if (!chartPeriodMessage) return;
        chartPeriodMessage.textContent = message;
        chartPeriodMessage.classList.toggle('is-error', type === 'error');
    };

    const getChartPeriodField = (type) => {
        return chartPeriodFields.find((field) => field.dataset.chartPeriodField === type) || null;
    };

    const getChartPeriodPartInput = (type, part) => {
        return getChartPeriodField(type)?.querySelector(`[data-chart-period-part="${part}"]`) || null;
    };

    const getChartPeriodNativeInput = (type) => {
        return document.querySelector(`[data-chart-period-native="${type}"]`);
    };

    const sanitizeChartPeriodPart = (input) => {
        if (!input) return;
        const maxLength = input.dataset.chartPeriodPart === 'year' ? 4 : 2;
        input.value = input.value.replace(/\D/g, '').slice(0, maxLength);
    };

    const normalizeChartPeriodPart = (input) => {
        sanitizeChartPeriodPart(input);
        const part = input?.dataset.chartPeriodPart;
        if ((part === 'month' || part === 'day') && input.value.length === 1) {
            input.value = input.value.padStart(2, '0');
        }
    };

    const getChartPeriodParts = (type) => {
        return {
            year: getChartPeriodPartInput(type, 'year')?.value || '',
            month: getChartPeriodPartInput(type, 'month')?.value || '',
            day: getChartPeriodPartInput(type, 'day')?.value || '',
        };
    };

    const hasAnyChartPeriodPart = (type) => {
        const parts = getChartPeriodParts(type);
        return Boolean(parts.year || parts.month || parts.day);
    };

    const getChartPeriodValue = (type) => {
        const parts = getChartPeriodParts(type);
        if (!parts.year && !parts.month && !parts.day) return '';
        if (parts.year.length !== 4 || parts.month.length !== 2 || parts.day.length !== 2) return '';
        return `${parts.year}-${parts.month}-${parts.day}`;
    };

    const isValidChartPeriodValue = (value) => {
        if (!value) return true;
        const [year, month, day] = value.split('-').map(Number);
        const date = new Date(year, month - 1, day);
        return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
    };

    const isChartPeriodWithinYears = (startDate, endDate, years) => {
        if (!startDate || !endDate || !years) return true;
        const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
        const [endYear, endMonth, endDay] = endDate.split('-').map(Number);
        const maxEndDate = new Date(startYear + years, startMonth - 1, startDay);
        const end = new Date(endYear, endMonth - 1, endDay);
        return end <= maxEndDate;
    };

    const setChartPeriodParts = (type, value) => {
        const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!match) return;
        const [, year, month, day] = match;
        const yearInput = getChartPeriodPartInput(type, 'year');
        const monthInput = getChartPeriodPartInput(type, 'month');
        const dayInput = getChartPeriodPartInput(type, 'day');
        if (yearInput) yearInput.value = year;
        if (monthInput) monthInput.value = month;
        if (dayInput) dayInput.value = day;
    };

    const normalizeAllChartPeriodParts = () => {
        chartPeriodFields.forEach((field) => {
            field.querySelectorAll('[data-chart-period-part]').forEach((input) => {
                normalizeChartPeriodPart(input);
            });
            syncChartPeriodNativeInput(field.dataset.chartPeriodField);
        });
    };

    const syncChartPeriodNativeInput = (type) => {
        const nativeInput = getChartPeriodNativeInput(type);
        if (!nativeInput) return;
        const value = getChartPeriodValue(type);
        nativeInput.value = isValidChartPeriodValue(value) ? value : '';
    };

    const hasCustomChartPeriod = () => {
        return hasAnyChartPeriodPart('start') || hasAnyChartPeriodPart('end');
    };

    const validateChartPeriod = () => {
        normalizeAllChartPeriodParts();
        const startDate = getChartPeriodValue('start');
        const endDate = getChartPeriodValue('end');
        if ((hasAnyChartPeriodPart('start') && !startDate) || (hasAnyChartPeriodPart('end') && !endDate)) {
            setChartPeriodMessage('날짜는 연도 4자리, 월/일 2자리로 입력하세요.', 'error');
            return false;
        }
        if (!isValidChartPeriodValue(startDate) || !isValidChartPeriodValue(endDate)) {
            setChartPeriodMessage('존재하는 날짜를 입력하세요.', 'error');
            return false;
        }
        if (startDate && endDate && startDate > endDate) {
            setChartPeriodMessage('시작일은 종료일보다 늦을 수 없습니다.', 'error');
            return false;
        }
        if (!isChartPeriodWithinYears(startDate, endDate, chartHistoryYears)) {
            setChartPeriodMessage(`${chartHistoryYears}년치 차트 데이터만 제공됩니다. ${chartHistoryYears}년 이내 기간을 선택하세요.`, 'error');
            return false;
        }
        setChartPeriodMessage('');
        return true;
    };

    const parseOrderNumber = (value) => {
        const normalized = String(value || '').replace(/[^\d]/g, '');
        return normalized ? Number(normalized) : 0;
    };

    const formatOrderInputValue = (input) => {
        if (!input) return;
        const value = parseOrderNumber(input.value);
        input.value = value ? formatNumber(value) : '';
    };

    const sanitizeOrderNumberInput = (input) => {
        if (!input) return;
        const cursor = input.selectionStart ?? input.value.length;
        const digitsBeforeCursor = input.value.slice(0, cursor).replace(/[^\d]/g, '').length;
        const digits = input.value.replace(/[^\d]/g, '');
        if (input.value === digits) return;

        input.value = digits;
        let nextCursor = input.value.length;
        let digitCount = 0;
        for (let index = 0; index < input.value.length; index += 1) {
            digitCount += 1;
            if (digitCount >= digitsBeforeCursor) {
                nextCursor = index + 1;
                break;
            }
        }
        input.setSelectionRange(nextCursor, nextCursor);
    };

    const allowOnlyOrderDigits = (event) => {
        if (event.inputType?.startsWith('delete')) return;
        if (event.data && /\D/.test(event.data)) {
            event.preventDefault();
        }
    };

    const escapeHtml = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const getOrderPriceStepFor = (price) => {
        if (price < 2000) return 1;
        if (price < 5000) return 5;
        if (price < 20000) return 10;
        if (price < 50000) return 50;
        if (price < 200000) return 100;
        if (price < 500000) return 500;
        return 1000;
    };

    const getOrderPriceStep = () => {
        const price = parseOrderNumber(orderPriceInput?.value) || latestStockPrice || 0;
        return getOrderPriceStepFor(price);
    };

    const isRegularOrderTime = () => {
        const now = new Date();
        const seoulParts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Seoul',
            weekday: 'short',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        }).formatToParts(now);
        const parts = Object.fromEntries(seoulParts.map((part) => [part.type, part.value]));
        if (['Sat', 'Sun'].includes(parts.weekday)) return false;

        const minutes = Number(parts.hour) * 60 + Number(parts.minute);
        return minutes >= 9 * 60 && minutes <= 15 * 60 + 30;
    };

    const setOrderMessage = (message = '', type = '', options = {}) => {
        if (!orderMessage) return;
        if (orderMessageTimer) {
            clearTimeout(orderMessageTimer);
            orderMessageTimer = null;
        }
        orderMessage.textContent = message;
        orderMessage.classList.toggle('is-error', type === 'error');
        orderMessage.classList.toggle('is-success', type === 'success');
        if (message && options.autoHide) {
            orderMessageTimer = setTimeout(() => {
                setOrderMessage('');
            }, options.autoHide);
        }
    };

    const renderPendingOrders = (orders = []) => {
        if (!pendingOrdersList) return;
        if (!orders.length) {
            pendingOrdersList.innerHTML = '<div class="pending-order-empty">미체결 내역이 없습니다.</div>';
            return;
        }

        pendingOrdersList.innerHTML = orders.map((order) => {
            const sideClass = order.side === 'sell' ? 'is-sell' : 'is-buy';
            const orderNo = escapeHtml(order.orderNo);
            const stockCode = escapeHtml(order.stockCode);
            const exchange = escapeHtml(order.exchange || 'SOR');
            return `
                <article class="pending-order-card ${sideClass}" data-order-no="${orderNo}" data-stock-code="${stockCode}" data-exchange="${exchange}">
                    <div class="pending-order-header">
                        <span class="pending-order-side">${escapeHtml(order.sideLabel)}</span>
                        <strong class="pending-order-name">${escapeHtml(order.stockName)}</strong>
                        <span class="pending-order-number">#${orderNo}</span>
                    </div>
                    <div class="pending-order-meta">
                        <span>주문가<strong>${formatNumber(order.orderPrice)}원</strong></span>
                        <span>미체결<strong>${formatNumber(order.pendingQuantity)}주</strong></span>
                        <span>상태<strong>${escapeHtml(order.orderStatus || '접수')}</strong></span>
                    </div>
                    <div class="pending-order-edit">
                        <div class="pending-order-stepper">
                            <input type="text" inputmode="numeric" value="${formatNumber(order.orderPrice)}" aria-label="정정 주문 가격" data-pending-price>
                            <button type="button" data-pending-step-target="price" data-step="-1" aria-label="정정 가격 감소">-</button>
                            <button type="button" data-pending-step-target="price" data-step="1" aria-label="정정 가격 증가">+</button>
                        </div>
                        <div class="pending-order-stepper">
                            <input type="text" inputmode="numeric" value="${formatNumber(order.pendingQuantity)}" aria-label="정정 주문 수량" data-pending-quantity>
                            <button type="button" data-pending-step-target="quantity" data-step="-1" aria-label="정정 수량 감소">-</button>
                            <button type="button" data-pending-step-target="quantity" data-step="1" aria-label="정정 수량 증가">+</button>
                        </div>
                        <div class="pending-order-actions">
                            <button type="button" data-modify-pending-order>정정</button>
                            <button type="button" data-cancel-pending-order>취소</button>
                        </div>
                    </div>
                </article>
            `;
        }).join('');
    };

    const fetchPendingOrders = async () => {
        if (!pendingOrdersList) return;
        if (pendingOrdersTimer) {
            clearTimeout(pendingOrdersTimer);
            pendingOrdersTimer = null;
        }

        const activeElement = document.activeElement;
        const isEditingPendingOrder = activeElement?.matches?.('[data-pending-price], [data-pending-quantity]');
        if (isEditingPendingOrder) {
            pendingOrdersTimer = setTimeout(fetchPendingOrders, 10000);
            return;
        }

        try {
            if (!currentStockCode) {
                renderPendingOrders([]);
                return;
            }
            const response = await authFetch(`/api/orders/pending?code=${encodeURIComponent(currentStockCode)}`, { cache: 'no-store' });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
            renderPendingOrders(payload.orders || []);
        } catch (error) {
            console.error('Pending order request failed.', error);
            pendingOrdersList.innerHTML = '<div class="pending-order-empty">미체결 내역을 조회하지 못했습니다.</div>';
        }

        if (currentOrderAction === 'pending') {
            pendingOrdersTimer = setTimeout(fetchPendingOrders, 10000);
        }
    };

    const updateOrderTotal = () => {
        if (!orderTotalInput) return;
        const quantity = parseOrderNumber(orderQuantityInput?.value);
        const price = parseOrderNumber(orderPriceInput?.value) || latestStockPrice;
        const total = quantity && price ? quantity * price : 0;
        orderTotalInput.value = total ? formatNumber(total) : '';
    };

    const setOrderableCashText = (text, isError = false) => {
        if (!orderAvailableAmount) return;
        orderAvailableAmount.value = text;
        orderAvailableAmount.classList.toggle('is-error', isError);
    };

    const setHoldingSummary = ({ priceText = '', quantityText = '', isError = false } = {}) => {
        if (orderHoldingPrice) {
            orderHoldingPrice.value = priceText;
        }
        if (orderHoldingQuantity) {
            orderHoldingQuantity.value = quantityText;
        }
        orderHoldingRow?.querySelector('.order-holding-summary')?.classList.toggle('is-error', isError);
    };

    const clampSellQuantityInput = () => {
        if (!orderQuantityInput || currentOrderAction !== 'sell' || latestSellableQuantity <= 0) return;
        const quantity = parseOrderNumber(orderQuantityInput.value);
        if (quantity > latestSellableQuantity) {
            orderQuantityInput.value = formatNumber(latestSellableQuantity);
            setOrderMessage(`매도 가능 수량은 ${formatNumber(latestSellableQuantity)}주입니다.`, 'error');
        }
    };

    const setSellableQuantity = ({ orderableQuantity = 0, holdingQuantity = 0, currentPrice = 0 } = {}) => {
        latestSellableQuantity = Math.max(0, Number(orderableQuantity || holdingQuantity) || 0);
        const displayPrice = Number(currentPrice) || latestStockPrice || 0;
        const displayQuantity = Number(holdingQuantity || orderableQuantity) || 0;
        setHoldingSummary({
            priceText: displayPrice ? `${formatNumber(displayPrice)}원` : '-',
            quantityText: `${formatNumber(displayQuantity)}주`,
        });
        clampSellQuantityInput();
    };

    const resetSellableQuantity = (message = '종목 선택 후 조회', isError = false) => {
        holdingRequestId += 1;
        latestSellableQuantity = 0;
        setHoldingSummary({
            priceText: message,
            quantityText: message,
            isError,
        });
    };

    const fetchStockHolding = async () => {
        if (!orderHoldingRow || currentOrderAction !== 'sell') return;
        const requestId = holdingRequestId + 1;
        holdingRequestId = requestId;

        if (!currentStockCode) {
            resetSellableQuantity('종목 선택 후 조회');
            return;
        }

        setHoldingSummary({ priceText: '조회 중...', quantityText: '조회 중...' });
        try {
            const response = await authFetch(`/api/account/holding?code=${encodeURIComponent(currentStockCode)}`, { cache: 'no-store' });
            const payload = await response.json().catch(() => ({}));
            if (requestId !== holdingRequestId) return;
            if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);

            setSellableQuantity({
                orderableQuantity: Number(payload.orderableQuantity ?? payload.quantity) || 0,
                holdingQuantity: Number(payload.holdingQuantity ?? payload.quantity) || 0,
                currentPrice: Number(payload.currentPrice) || 0,
            });
        } catch (error) {
            if (requestId !== holdingRequestId) return;
            console.error('Account holding request failed.', error);
            resetSellableQuantity('보유 수량 조회 실패', true);
        }
    };

    const fetchOrderableCash = async () => {
        if (!orderAvailableAmount) return;
        if (orderableCashTimer) {
            clearTimeout(orderableCashTimer);
        }

        if (!isApiServerAvailable) {
            setOrderableCashText('계좌 조회 실패', true);
            orderableCashTimer = setTimeout(fetchOrderableCash, 60000);
            return;
        }

        setOrderableCashText('조회 중...');
        try {
            const response = await authFetch('/api/account/orderable-cash', { cache: 'no-store' });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);

            const amount = Number(payload.orderableAmount) || 0;
            setOrderableCashText(`${formatNumber(amount)}원`);
        } catch (error) {
            console.error('Account cash request failed.', error);
            setOrderableCashText('계좌 조회 실패', true);
        }

        orderableCashTimer = setTimeout(fetchOrderableCash, 60000);
    };

    const updateOrderSubmitLabel = () => {
        if (!orderSubmitButton) return;
        const label = currentOrderAction === 'sell' ? '매도' : currentOrderAction === 'pending' ? '대기' : '매수';
        orderSubmitButton.textContent = `${label} 주문하기`;
        orderSubmitButton.classList.toggle('is-sell', currentOrderAction === 'sell');
        orderSubmitButton.disabled = currentOrderAction === 'pending';
    };

    const setOrderAction = (action) => {
        currentOrderAction = ['buy', 'sell', 'pending'].includes(action) ? action : 'buy';
        orderActionButtons.forEach((button) => {
            button.classList.toggle('is-active', button.dataset.orderAction === currentOrderAction);
        });
        const isPending = currentOrderAction === 'pending';
        document.querySelectorAll('.order-trade-section').forEach((element) => {
            element.classList.toggle('hidden', isPending);
        });
        orderHoldingRow?.classList.toggle('hidden', isPending || currentOrderAction !== 'sell');
        pendingOrdersPanel?.classList.toggle('hidden', !isPending);
        if (isPending) {
            setOrderMessage('');
            fetchPendingOrders();
        } else if (pendingOrdersTimer) {
            clearTimeout(pendingOrdersTimer);
            pendingOrdersTimer = null;
        }
        if (currentOrderAction === 'sell') {
            fetchStockHolding();
        } else {
            resetSellableQuantity();
        }
        updateOrderSubmitLabel();
    };

    const setOrderPriceMode = (mode) => {
        const previousMode = currentOrderPriceMode;
        currentOrderPriceMode = mode === 'market' ? 'market' : 'limit';
        orderPriceButtons.forEach((button) => {
            button.classList.toggle('is-active', button.dataset.priceMode === currentOrderPriceMode);
        });

        if (orderPriceInput) {
            orderPriceInput.disabled = currentOrderPriceMode === 'market';
            orderPriceInput.placeholder = currentOrderPriceMode === 'market' ? '현재가 기준' : '가격 입력';
            if (latestStockPrice && (currentOrderPriceMode === 'market' || previousMode !== currentOrderPriceMode)) {
                orderPriceInput.value = formatNumber(latestStockPrice);
                hasUserEditedOrderPrice = false;
            }
        }
        orderPriceStepButtons.forEach((button) => {
            button.classList.toggle('hidden', currentOrderPriceMode === 'market');
        });
        updateOrderTotal();
    };

    const updateOrderFromQuote = (price) => {
        latestStockPrice = Number(price) || latestStockPrice || 0;
        const shouldUpdateOrderPrice = currentOrderPriceMode === 'market'
            || (!parseOrderNumber(orderPriceInput?.value) && !hasUserEditedOrderPrice);
        if (orderPriceInput && latestStockPrice && shouldUpdateOrderPrice) {
            orderPriceInput.value = formatNumber(latestStockPrice);
        }
        updateOrderTotal();
    };

    const changeOrderInputValue = (target, delta) => {
        const input = target === 'quantity' ? orderQuantityInput : orderPriceInput;
        if (!input || input.disabled) return;
        const step = target === 'quantity' ? 1 : getOrderPriceStep();
        let nextValue = Math.max(0, parseOrderNumber(input.value) + (Number(delta) || 0) * step);
        if (target === 'quantity' && currentOrderAction === 'sell' && latestSellableQuantity > 0) {
            nextValue = Math.min(nextValue, latestSellableQuantity);
        }
        input.value = nextValue ? formatNumber(nextValue) : '';
        if (target === 'price') {
            hasUserEditedOrderPrice = true;
        }
        updateOrderTotal();
    };

    const submitStockOrder = async () => {
        if (currentOrderAction === 'pending') {
            setOrderMessage('대기 주문은 아직 주문 전송 대상이 아닙니다.', 'error');
            return;
        }

        const quantity = parseOrderNumber(orderQuantityInput?.value);
        const price = currentOrderPriceMode === 'market' ? 0 : parseOrderNumber(orderPriceInput?.value);
        if (!currentStockCode) {
            setOrderMessage('먼저 종목을 검색해서 선택하세요.', 'error');
            return;
        }
        if (!quantity) {
            setOrderMessage('주문 수량을 입력하세요.', 'error');
            return;
        }
        if (currentOrderAction === 'sell' && latestSellableQuantity <= 0) {
            setOrderMessage('매도 가능한 보유 수량이 없습니다.', 'error');
            return;
        }
        if (currentOrderAction === 'sell' && quantity > latestSellableQuantity) {
            setOrderMessage(`매도 가능 수량은 ${formatNumber(latestSellableQuantity)}주입니다.`, 'error');
            return;
        }
        if (currentOrderPriceMode === 'limit' && !price) {
            setOrderMessage('지정가 주문 가격을 입력하세요.', 'error');
            return;
        }
        if (!isRegularOrderTime()) {
            setOrderMessage('현재는 정규장 시간이 아닙니다. 정규장(09:00~15:30)에만 주문할 수 있습니다.', 'error');
            return;
        }

        orderSubmitButton.disabled = true;
        setOrderMessage('주문을 전송하는 중입니다...');

        try {
            const response = await authFetch('/api/order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: currentOrderAction,
                    stockCode: currentStockCode,
                    priceMode: currentOrderPriceMode,
                    price,
                    quantity,
                }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);

            const orderNo = payload.orderNo ? ` 주문번호 ${payload.orderNo}` : '';
            const doneText = currentOrderAction === 'sell' ? '매도 주문완료' : '매수 주문완료';
            setOrderMessage(`${doneText}${orderNo}`, 'success', { autoHide: 4000 });
            fetchOrderableCash();
            if (currentOrderAction === 'sell') fetchStockHolding();
        } catch (error) {
            setOrderMessage(error.message || '주문 전송에 실패했습니다.', 'error');
        } finally {
            updateOrderSubmitLabel();
        }
    };

    orderActionButtons.forEach((button) => {
        button.addEventListener('click', () => setOrderAction(button.dataset.orderAction));
    });

    orderPriceButtons.forEach((button) => {
        button.addEventListener('click', () => setOrderPriceMode(button.dataset.priceMode));
    });

    document.querySelectorAll('[data-step-target]').forEach((button) => {
        button.addEventListener('click', () => {
            changeOrderInputValue(button.dataset.stepTarget, button.dataset.step);
        });
    });

    orderPriceInput?.addEventListener('input', () => {
        sanitizeOrderNumberInput(orderPriceInput);
        hasUserEditedOrderPrice = true;
        updateOrderTotal();
    });

    orderPriceInput?.addEventListener('beforeinput', allowOnlyOrderDigits);

    orderPriceInput?.addEventListener('blur', () => {
        formatOrderInputValue(orderPriceInput);
        updateOrderTotal();
    });

    orderQuantityInput?.addEventListener('input', () => {
        sanitizeOrderNumberInput(orderQuantityInput);
        clampSellQuantityInput();
        updateOrderTotal();
    });

    orderQuantityInput?.addEventListener('beforeinput', allowOnlyOrderDigits);

    orderQuantityInput?.addEventListener('blur', () => {
        clampSellQuantityInput();
        formatOrderInputValue(orderQuantityInput);
        updateOrderTotal();
    });

    pendingOrdersList?.addEventListener('beforeinput', (event) => {
        if (event.target.matches('[data-pending-price], [data-pending-quantity]')) {
            allowOnlyOrderDigits(event);
        }
    });

    pendingOrdersList?.addEventListener('input', (event) => {
        const input = event.target.closest('[data-pending-price], [data-pending-quantity]');
        if (input) sanitizeOrderNumberInput(input);
    });

    pendingOrdersList?.addEventListener('blur', (event) => {
        const input = event.target.closest('[data-pending-price], [data-pending-quantity]');
        if (input) formatOrderInputValue(input);
    }, true);

    pendingOrdersList?.addEventListener('click', async (event) => {
        const stepButton = event.target.closest('[data-pending-step-target]');
        if (stepButton) {
            const card = stepButton.closest('.pending-order-card');
            if (!card) return;

            const target = stepButton.dataset.pendingStepTarget;
            const input = target === 'quantity'
                ? card.querySelector('[data-pending-quantity]')
                : card.querySelector('[data-pending-price]');
            if (!input) return;

            const value = parseOrderNumber(input.value);
            const step = target === 'quantity' ? 1 : getOrderPriceStepFor(value);
            const nextValue = Math.max(0, value + (Number(stepButton.dataset.step) || 0) * step);
            input.value = nextValue ? formatNumber(nextValue) : '';
            return;
        }

        const button = event.target.closest('[data-modify-pending-order], [data-cancel-pending-order]');
        if (!button) return;

        const card = button.closest('.pending-order-card');
        if (!card) return;

        const quantity = parseOrderNumber(card.querySelector('[data-pending-quantity]')?.value);
        if (button.matches('[data-cancel-pending-order]')) {
            if (!quantity) {
                setOrderMessage('취소 수량을 입력하세요.', 'error');
                return;
            }

            button.disabled = true;
            setOrderMessage('취소 주문을 전송하는 중입니다...');
            try {
                const response = await authFetch('/api/order/cancel', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        orderNo: card.dataset.orderNo,
                        stockCode: card.dataset.stockCode,
                        exchange: card.dataset.exchange || 'SOR',
                        quantity,
                    }),
                });
                const payload = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
                setOrderMessage('취소 주문완료', 'success', { autoHide: 4000 });
                fetchPendingOrders();
            } catch (error) {
                setOrderMessage(error.message || '취소 주문에 실패했습니다.', 'error');
            } finally {
                button.disabled = false;
            }
            return;
        }

        const price = parseOrderNumber(card.querySelector('[data-pending-price]')?.value);
        if (!price || !quantity) {
            setOrderMessage('정정 가격과 수량을 입력하세요.', 'error');
            return;
        }

        button.disabled = true;
        setOrderMessage('정정 주문을 전송하는 중입니다...');
        try {
            const response = await authFetch('/api/order/modify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    orderNo: card.dataset.orderNo,
                    stockCode: card.dataset.stockCode,
                    exchange: card.dataset.exchange || 'SOR',
                    price,
                    quantity,
                }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
            setOrderMessage('정정 주문완료', 'success', { autoHide: 4000 });
            fetchPendingOrders();
        } catch (error) {
            setOrderMessage(error.message || '정정 주문에 실패했습니다.', 'error');
        } finally {
            button.disabled = false;
        }
    });

    orderForm?.addEventListener('submit', (event) => {
        event.preventDefault();
        submitStockOrder();
    });

    const getIndicatorFieldValue = (indicator, field) => {
        const values = normalizeIndicatorValues(indicator.key, indicator.values);
        return values[field.key] ?? field.value;
    };

    const loadSavedIndicatorStrategies = async () => {
        try {
            const response = await authFetch('/api/indicator-strategies', { cache: 'no-store' });
            if (!response.ok) {
                const errorPayload = await response.json().catch(() => ({}));
                throw new Error(errorPayload.message || `HTTP ${response.status}`);
            }

            const payload = await response.json();
            return Array.isArray(payload.strategies) ? payload.strategies : [];
        } catch (error) {
            console.warn('Saved indicator strategies request failed.', error);
            setStrategyMessage('저장한 전략을 불러오지 못했습니다.');
            return [];
        }
    };

    const createSavedIndicatorStrategy = async (strategy) => {
        const response = await authFetch('/api/indicator-strategies', {
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
        const response = await authFetch(`/api/indicator-strategies/${encodeURIComponent(id)}`, {
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

    const deleteSavedIndicatorStrategy = async (id) => {
        const response = await authFetch(`/api/indicator-strategies/${encodeURIComponent(id)}`, {
            method: 'DELETE',
        });

        if (!response.ok) {
            const errorPayload = await response.json().catch(() => ({}));
            throw new Error(errorPayload.message || `HTTP ${response.status}`);
        }
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

    const normalizeStrategyName = (value) => String(value || '').replace(/\s+/g, '').toLowerCase();

    const isDuplicateStrategyName = (name, currentId = '') => {
        const normalized = normalizeStrategyName(name);
        return savedIndicatorStrategies.some((strategy) => {
            return strategy.id !== currentId && normalizeStrategyName(strategy.name) === normalized;
        });
    };

    const getMatchingIndicatorDefinitions = (query = '') => {
        const normalized = String(query || '').trim().toLowerCase();
        const availableDefinitions = indicatorDefinitions.filter((definition) => !isIndicatorActive(definition.key));
        if (!normalized) return availableDefinitions;

        return availableDefinitions.filter((definition) => {
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
            : '<div class="indicator-empty">추가할 보조지표가 없습니다.</div>';

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

                    if (field.type === 'color') {
                        return `
                            <div class="indicator-field indicator-color-field">
                                <label>${field.label}</label>
                                <input type="color" value="${value}" data-indicator-id="${indicator.id}" data-field-key="${field.key}">
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
        activeIndicators = dedupeIndicatorsByKey(strategy.indicators).map((indicator) => {
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
        if (isIndicatorActive(definition.key)) {
            setStrategyMessage('이미 추가된 보조지표입니다.');
            indicatorSearchInput.value = '';
            hideIndicatorDropdown();
            return;
        }

        activeIndicators.push(cloneIndicatorFromDefinition(definition));
        indicatorSearchInput.value = '';
        hideIndicatorDropdown();
        setStrategyMessage('');
        renderIndicatorCards();
        redrawLatestChart();
    };

    const addIndicatorByKey = (key) => {
        const definition = getIndicatorDefinition(key);
        if (!definition) return;
        if (isIndicatorActive(definition.key)) {
            setStrategyMessage('이미 추가된 보조지표입니다.');
            if (indicatorSearchInput) indicatorSearchInput.value = '';
            hideIndicatorDropdown();
            return;
        }

        activeIndicators.push(cloneIndicatorFromDefinition(definition));
        if (indicatorSearchInput) indicatorSearchInput.value = '';
        hideIndicatorDropdown();
        setStrategyMessage('');
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

        indicatorDeleteButton?.addEventListener('click', () => {
            const selectedStrategy = getSelectedStrategy();
            if (!selectedStrategy) {
                setStrategyMessage('삭제할 전략을 선택하세요.');
                return;
            }

            indicatorDeleteButton.disabled = true;
            deleteSavedIndicatorStrategy(selectedStrategy.id)
                .then(() => {
                    savedIndicatorStrategies = savedIndicatorStrategies.filter((strategy) => strategy.id !== selectedStrategy.id);
                    renderSavedStrategyOptions();
                    if (savedStrategySelect) savedStrategySelect.value = '';
                    if (strategyNameInput) strategyNameInput.value = selectedStrategy.name;
                    setStrategyMessage('전략을 삭제했습니다. 현재 설정은 다시 저장할 수 있습니다.');
                    renderIndicatorCards();
                    redrawLatestChart();
                })
                .catch((error) => {
                    console.error('Indicator strategy delete failed.', error);
                    setStrategyMessage(error.message || '전략을 삭제하지 못했습니다.');
                })
                .finally(() => {
                    indicatorDeleteButton.disabled = false;
                });
        });

        indicatorSaveButton?.addEventListener('click', () => {
            if (!activeIndicators.length) {
                setStrategyMessage('저장할 보조지표를 먼저 추가하세요.');
                return;
            }

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
                indicators: dedupeIndicatorsByKey(activeIndicators).map((indicator) => ({
                    key: indicator.key,
                    values: { ...indicator.values },
                })),
            };

            const canUpdateSelectedStrategy = selectedStrategy
                && !String(selectedStrategy.id).startsWith('preset-')
                && normalizeStrategyName(selectedStrategy.name) === normalizeStrategyName(strategyName);
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
                    } else {
                        setStrategyMessage(error.message || '전략을 저장하지 못했습니다.');
                    }
                });
        });
    };

    const getUrlParams = () => {
        return new URLSearchParams(window.location.search);
    };

    const updateChartUrl = (code = currentStockCode, interval = currentChartInterval) => {
        if (!code) {
            window.history.replaceState(null, '', window.location.pathname);
            return;
        }

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

        if (!isApiServerAvailable) {
            serverConnectionStatus.classList.remove('is-connected');
            serverConnectionStatus.classList.add('is-disconnected');
            serverConnectionText.textContent = 'API연결실패';
            return;
        }

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

    const setApiServerAvailability = (isAvailable) => {
        if (isApiServerAvailable === isAvailable) return;
        isApiServerAvailable = isAvailable;
        updateMarketSessionStatus();
        if (!isAvailable) {
            setOrderableCashText('계좌 조회 실패', true);
        } else if (currentOrderAction !== 'pending') {
            fetchOrderableCash();
        }
    };

    const checkApiServerHealth = async () => {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 2500);

        try {
            const response = await fetch('/api/health', {
                cache: 'no-store',
                signal: controller.signal,
            });
            setApiServerAvailability(response.ok);
        } catch {
            setApiServerAvailability(false);
        } finally {
            window.clearTimeout(timeoutId);
        }
    };

    const startApiHealthTimer = () => {
        checkApiServerHealth();
        if (apiHealthTimer) clearInterval(apiHealthTimer);
        apiHealthTimer = setInterval(checkApiServerHealth, 5000);
    };

    const setLoadingView = () => {
        if (stockEls.name) stockEls.name.textContent = '-';
        if (stockEls.code) stockEls.code.textContent = '-';
        if (stockEls.price) stockEls.price.textContent = '-';
        if (stockEls.change) stockEls.change.textContent = '-';
        if (stockEls.high) stockEls.high.textContent = '-';
        if (stockEls.low) stockEls.low.textContent = '-';
        if (stockEls.volume) stockEls.volume.textContent = '-';
        if (orderPriceInput) orderPriceInput.value = '';
        hasUserEditedOrderPrice = false;

        setDirectionClass(stockEls.price, 'flat');
        setDirectionClass(stockEls.change, 'flat');
        setDirectionClass(stockEls.high, 'flat');
        setDirectionClass(stockEls.low, 'flat');
    };

    const resetStockView = () => {
        currentStockCode = '';
        latestStockPrice = 0;
        if (refreshTimer) {
            clearInterval(refreshTimer);
            refreshTimer = null;
        }
        if (realtimeSource) {
            realtimeSource.close();
            realtimeSource = null;
        }

        setLoadingView();
        latestCandles = [];
        chartStartIndex = 0;
        chartHoverPoint = null;
        setTodayChartCandleStatus(false);
        updateChartUrl('');
        redrawLatestChart();
        resetSellableQuantity();
        updateOrderTotal();
    };

    const updateStockView = (stock) => {
        const direction = stock.direction || 'flat';
        const sign = direction === 'up' ? '\u25B2' : direction === 'down' ? '\u25BC' : '-';

        currentStockCode = stock.code || currentStockCode;
        latestStockPrice = Number(stock.price) || latestStockPrice || 0;

        if (stockEls.name) stockEls.name.textContent = stock.name || '-';
        if (stockEls.code) stockEls.code.textContent = stock.code || '-';
        if (stockEls.price) stockEls.price.textContent = formatNumber(stock.price);
        if (stockEls.change) {
            stockEls.change.textContent = `${sign} ${formatNumber(Math.abs(stock.change || 0))} (${Number(stock.changeRate || 0).toFixed(2)}%)`;
        }
        if (stockEls.high) stockEls.high.textContent = formatNumber(stock.high);
        if (stockEls.low) stockEls.low.textContent = formatNumber(stock.low);
        if (stockEls.volume) stockEls.volume.textContent = formatNumber(stock.volume);
        if (currentOrderAction === 'pending') {
            fetchPendingOrders();
        } else if (currentOrderAction === 'sell') {
            fetchStockHolding();
        }

        setDirectionClass(stockEls.price, direction);
        setDirectionClass(stockEls.change, direction);
        setDirectionClass(stockEls.high, 'up');
        setDirectionClass(stockEls.low, 'down');
        updateOrderFromQuote(stock.price);
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
        latestChartLayout = drawStockChart({
            chartCanvas,
            resizeChartCanvas,
            candles: getVisibleCandles(),
            activeIndicators,
            indicatorScrollOffset: lowerIndicatorScrollOffset,
            chartHoverPoint,
            currentChartInterval,
            priceScaleZoom,
            formatChartTime,
            setChartStatus,
        });

        if (latestChartLayout) {
            lowerIndicatorScrollOffset = latestChartLayout.indicatorScrollOffset;
        } else {
            lowerIndicatorScrollOffset = 0;
        }
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
        const priceAreaBottomLimit = latestChartLayout?.priceBottom ?? height * 0.72;
        return x >= width - priceAxisWidth && y <= priceAreaBottomLimit;
    };

    const isInLowerIndicatorArea = (y) => {
        return latestChartLayout
            && latestChartLayout.maxIndicatorScrollOffset > 0
            && y >= latestChartLayout.lowerViewportTop
            && y <= latestChartLayout.lowerViewportBottom;
    };

    const scrollLowerIndicators = (deltaY) => {
        if (!latestChartLayout?.maxIndicatorScrollOffset) return false;

        lowerIndicatorScrollOffset += deltaY;
        lowerIndicatorScrollOffset = Math.max(
            0,
            Math.min(latestChartLayout.maxIndicatorScrollOffset, lowerIndicatorScrollOffset),
        );
        requestChartRedraw();
        return true;
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

    const fetchChart = async (code = currentStockCode, interval = currentChartInterval) => {
        const requestInterval = interval || DEFAULT_CHART_INTERVAL;
        if (!code) {
            chartRequestId += 1;
            if (chartRetryTimer) {
                clearTimeout(chartRetryTimer);
                chartRetryTimer = null;
            }
            latestCandles = [];
            latestCandlesInterval = null;
            setTodayChartCandleStatus(false);
            redrawLatestChart();
            return;
        }

        const requestId = chartRequestId + 1;
        chartRequestId = requestId;
        const shouldRetryChart = isRegularMarketTime();
        if (latestCandlesInterval !== requestInterval) {
            latestCandles = [];
            latestCandlesInterval = null;
            chartStartIndex = 0;
            chartHoverPoint = null;
            redrawLatestChart();
        }
        if (chartRetryTimer) {
            clearTimeout(chartRetryTimer);
            chartRetryTimer = null;
        }

        const scheduleChartRetry = (message) => {
            if (requestId !== chartRequestId || chartRetryTimer) return;
            setChartStatus(message);
            chartRetryTimer = setTimeout(() => {
                chartRetryTimer = null;
                if (currentStockCode === code && currentChartInterval === requestInterval) {
                    fetchChart(code, requestInterval);
                }
            }, 5000);
        };

        try {
            if (shouldRetryChart) {
                setChartStatus('차트 데이터를 불러오는 중...');
            } else {
                setChartStatus('');
            }
            const params = new URLSearchParams({ interval: requestInterval });
            if (isStaticStrategyChart) {
                params.set('settled', '1');
                const startDate = getChartPeriodValue('start');
                const endDate = getChartPeriodValue('end');
                const hasPeriod = Boolean(startDate || endDate);
                if (!hasPeriod && chartHistoryYears > 0) {
                    params.set('years', String(chartHistoryYears));
                }
                if (startDate) {
                    params.set('startDate', startDate);
                }
                if (endDate) {
                    params.set('endDate', endDate);
                }
                params.set('limit', hasCustomChartPeriod() ? '0' : String(chartCandleLimit || 500));
            } else if (chartHistoryYears > 0) {
                params.set('years', String(chartHistoryYears));
            }

            const response = await authFetch(`/api/chart/${encodeURIComponent(code)}?${params.toString()}`, {
                cache: 'no-store',
            });

            if (!response.ok) {
                const errorPayload = await response.json().catch(() => ({}));
                throw new Error(errorPayload.message || `HTTP ${response.status}`);
            }

            const payload = await response.json();
            if (requestId !== chartRequestId) return;

            const nextCandles = payload.candles || [];
            if (!nextCandles.length) {
                if (!shouldRetryChart) {
                    if (latestCandlesInterval !== requestInterval) {
                        latestCandles = [];
                        latestCandlesInterval = null;
                        setTodayChartCandleStatus(false);
                        redrawLatestChart();
                    }
                    return;
                }

                if (latestCandles.length) {
                    scheduleChartRetry('차트 데이터가 잠시 비어 있어 기존 차트를 유지합니다. 다시 확인 중...');
                    return;
                }
                scheduleChartRetry('차트 데이터를 다시 확인하는 중...');
                return;
            }

            latestCandles = nextCandles;
            latestCandlesInterval = requestInterval;
            setTodayChartCandleStatus(hasTodayCandle(latestCandles));
            visibleCandleCount = Math.min(Math.max(60, visibleCandleCount), Math.max(60, latestCandles.length));
            snapChartToLatest();
            redrawLatestChart();
        } catch (error) {
            if (requestId !== chartRequestId) return;
            console.error('Chart request failed.', error);
            if (!shouldRetryChart) {
                if (latestCandlesInterval !== requestInterval) {
                    latestCandles = [];
                    latestCandlesInterval = null;
                    setTodayChartCandleStatus(false);
                    redrawLatestChart();
                }
                return;
            }

            if (latestCandles.length) {
                scheduleChartRetry('차트 요청이 잠시 실패해 기존 차트를 유지합니다. 다시 확인 중...');
                return;
            }
            scheduleChartRetry('차트 데이터를 다시 확인하는 중...');
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

        if (tick.price) {
            latestStockPrice = Number(tick.price) || latestStockPrice;
            updateOrderFromQuote(tick.price);
        }
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

    const startRealtime = async (code) => {
        if (!code) return;

        if (realtimeSource) {
            realtimeSource.close();
            realtimeSource = null;
        }

        realtimeSource = await createAuthenticatedEventSource(`/api/realtime/${encodeURIComponent(code)}`);

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
                setLoadingView();
            }
            const response = await authFetch(`/api/stock/${encodeURIComponent(keyword)}`, {
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
            if (showLoading) {
                resetStockView();
            }
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

    const getDefaultRankingStock = async () => {
        try {
            const response = await authFetch('/api/home-rankings?type=realtime&limit=1', {
                cache: 'no-store',
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
            return payload.items?.[0]?.code || payload.items?.[0]?.name || '';
        } catch (error) {
            console.error('Default realtime ranking request failed.', error);
            return '';
        }
    };

    const loadDefaultRankingStock = async () => {
        const target = await getDefaultRankingStock();
        if (!target || currentStockCode) return;
        await selectStock(target);
    };

    const selectStock = async (query) => {
        const stock = await fetchStock(query, {
            closeSearch: true,
            showLoading: true,
        });
        if (!stock) return;

        updateChartUrl(stock.code);
        await fetchChart(stock.code);
        if (!isStaticStrategyChart) {
            startRealtime(stock.code);
        }
        if (searchBar) {
            searchBar.value = '';
        }
        clearSearchDraft();
        updateSearchClearButton();
        renderSearchMessage('종목명 또는 종목코드를 입력하세요.');
        if (!isStaticStrategyChart) {
            startAutoRefresh();
        }
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
            latestResults = [];
            activeSearchIndex = -1;
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
            const keyword = searchBar.value.trim();
            const selected = activeSearchIndex >= 0 ? latestResults[activeSearchIndex] : latestResults[0];
            const target = selected?.code || keyword;
            if (!target) {
                renderSearchMessage('종목명 또는 종목코드를 입력하세요.');
                return;
            }

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
            if (isStaticStrategyChart && !validateChartPeriod()) return;
            fetchChart(currentStockCode, currentChartInterval);
            if (currentStockCode && !isStaticStrategyChart) {
                startRealtime(currentStockCode);
            }
        });
    });

    chartPeriodFields.forEach((field) => {
        const type = field.dataset.chartPeriodField;
        field.querySelectorAll('[data-chart-period-part]').forEach((input) => {
            input.addEventListener('input', () => {
                sanitizeChartPeriodPart(input);
                syncChartPeriodNativeInput(type);
                setChartPeriodMessage('');
            });
            input.addEventListener('blur', () => {
                normalizeChartPeriodPart(input);
                syncChartPeriodNativeInput(type);
            });
        });
    });

    chartPeriodCalendarButtons.forEach((button) => {
        button.addEventListener('click', () => {
            const type = button.dataset.chartPeriodCalendar;
            const nativeInput = getChartPeriodNativeInput(type);
            if (!nativeInput) return;
            syncChartPeriodNativeInput(type);
            try {
                if (typeof nativeInput.showPicker === 'function') {
                    nativeInput.showPicker();
                } else {
                    nativeInput.click();
                }
            } catch {
                nativeInput.focus();
                nativeInput.click();
            }
        });
    });

    [chartPeriodStartInput, chartPeriodEndInput].forEach((input) => {
        input?.addEventListener('change', () => {
            setChartPeriodParts(input.dataset.chartPeriodNative, input.value);
            setChartPeriodMessage('');
        });
    });

    chartPeriodApplyButton?.addEventListener('click', () => {
        if (!validateChartPeriod()) return;
        if (!currentStockCode) {
            setChartPeriodMessage('종목을 먼저 검색하세요.', 'error');
            return;
        }
        fetchChart(currentStockCode, currentChartInterval);
    });

    chartPeriodResetButton?.addEventListener('click', () => {
        chartPeriodFields.forEach((field) => {
            field.querySelectorAll('[data-chart-period-part]').forEach((input) => {
                input.value = '';
            });
        });
        if (chartPeriodStartInput) chartPeriodStartInput.value = '';
        if (chartPeriodEndInput) chartPeriodEndInput.value = '';
        setChartPeriodMessage('');
        if (currentStockCode) {
            fetchChart(currentStockCode, currentChartInterval);
        }
    });

    if (chartCanvas) {
        chartCanvas.addEventListener('wheel', (event) => {
            event.preventDefault();
            const rect = chartCanvas.getBoundingClientRect();
            const mouseY = event.clientY - rect.top;
            if (isInLowerIndicatorArea(mouseY) && scrollLowerIndicators(event.deltaY)) {
                return;
            }

            zoomChart(event.deltaY < 0 ? 'in' : 'out');
        }, { passive: false });

        chartCanvas.addEventListener('mousemove', (event) => {
            const rect = chartCanvas.getBoundingClientRect();
            const mouseX = event.clientX - rect.left;
            const mouseY = event.clientY - rect.top;

            if (!isChartDragging && !isPriceScaleDragging) {
                if (isInPriceAxisArea(mouseX, rect.width, mouseY, rect.height)) {
                    chartCanvas.style.cursor = 'ns-resize';
                } else if (isInLowerIndicatorArea(mouseY)) {
                    chartCanvas.style.cursor = 'default';
                } else {
                    chartCanvas.style.cursor = 'grab';
                }
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
    startApiHealthTimer();
    setActiveIntervalButton();
    setRightPanel(document.body.dataset.defaultPanel || 'order');
    setOrderAction('buy');
    setOrderPriceMode('limit');
    initIndicatorStrategyPanel();
    redrawLatestChart();

    const urlParams = getUrlParams();
    const initialCode = urlParams.get('code');
    const initialInterval = urlParams.get('interval');

    if (availableChartIntervals.includes(initialInterval)) {
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
            if (!isStaticStrategyChart) {
                startRealtime(stock.code);
                startAutoRefresh();
            }
        });
    } else {
        loadDefaultRankingStock();
    }
});
