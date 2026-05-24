const { requestKiwoomTr } = require('./kiwoomAuth');

const ORDER_ENDPOINT = '/api/dostk/ordr';
const ORDER_API_IDS = {
    buy: 'kt10000',
    sell: 'kt10001',
};
const ACCOUNT_ENDPOINT = '/api/dostk/acnt';

function getKoreaDateParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Seoul',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).formatToParts(date);

    return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function isRegularMarketTime(date = new Date()) {
    const parts = getKoreaDateParts(date);
    if (['Sat', 'Sun'].includes(parts.weekday)) return false;

    const minutes = Number(parts.hour) * 60 + Number(parts.minute);
    return minutes >= 9 * 60 && minutes <= 15 * 60 + 30;
}

function normalizeOrderRejectionMessage(error, action) {
    const message = String(error?.message || error || '');
    const compact = message.replace(/\s+/g, '');
    const isFundsIssue = /(예수금|증거금|주문가능|매수가능|현금|잔고).*(부족|초과|불가)|(부족|초과|불가).*(예수금|증거금|주문가능|매수가능|현금)/.test(compact);
    const isHoldingIssue = /(잔고|보유|매도가능|수량).*(부족|초과|불가)|(부족|초과|불가).*(잔고|보유|매도가능|수량)/.test(compact);

    if (action === 'buy' && isFundsIssue) {
        return '주문 가능 금액이 부족합니다. 주문 가능 금액과 주문 예상 금액을 확인하세요.';
    }
    if (action === 'sell' && isHoldingIssue) {
        return '매도 가능한 보유 수량이 부족합니다.';
    }
    return message || '주문 요청이 거절되었습니다.';
}

const normalizeInteger = (value) => {
    const normalized = String(value || '').replace(/[^\d]/g, '');
    return Number(normalized);
};

const normalizeStockCode = (value) => String(value || '').replace(/[^A-Za-z0-9]/g, '').trim();

const normalizeAmount = (value) => {
    const normalized = String(value ?? '').replace(/[^\d.-]/g, '');
    const amount = Number(normalized);
    return Number.isFinite(amount) ? Math.abs(amount) : 0;
};

const normalizeText = (value) => String(value ?? '').trim();

const getPendingSide = (order) => {
    const text = `${order.io_tp_nm || ''} ${order.trde_tp || ''}`;
    if (text.includes('매도')) return 'sell';
    return 'buy';
};

const getPendingExchange = (order) => {
    if (String(order.sor_yn || '').toUpperCase() === 'Y') return 'SOR';
    if (String(order.stex_tp) === '1') return 'KRX';
    if (String(order.stex_tp) === '2') return 'NXT';
    return 'SOR';
};

const normalizePendingOrder = (order) => {
    const side = getPendingSide(order);
    return {
        orderNo: normalizeText(order.ord_no),
        originalOrderNo: normalizeText(order.orig_ord_no),
        stockCode: normalizeStockCode(order.stk_cd),
        stockName: normalizeText(order.stk_nm) || normalizeStockCode(order.stk_cd),
        side,
        sideLabel: side === 'sell' ? '매도' : '매수',
        orderType: normalizeText(order.trde_tp) || '보통',
        orderStatus: normalizeText(order.ord_stt),
        orderQuantity: normalizeAmount(order.ord_qty),
        pendingQuantity: normalizeAmount(order.oso_qty),
        orderPrice: normalizeAmount(order.ord_pric),
        currentPrice: normalizeAmount(order.cur_prc),
        orderTime: normalizeText(order.tm || order.ord_tm),
        exchange: getPendingExchange(order),
    };
};

async function getPendingOrders(stockCode = '', credentials = null) {
    const normalizedStockCode = normalizeStockCode(stockCode);
    const payload = await requestKiwoomTr('ka10075', {
        all_stk_tp: normalizedStockCode ? '1' : '0',
        trde_tp: '0',
        stk_cd: normalizedStockCode,
        stex_tp: '0',
    }, ACCOUNT_ENDPOINT, credentials);

    const returnCode = Number(payload.return_code ?? 0);
    if (returnCode !== 0) {
        throw new Error(payload.return_msg || '미체결 주문을 조회하지 못했습니다.');
    }

    const orders = Array.isArray(payload.oso) ? payload.oso : [];
    return orders
        .map(normalizePendingOrder)
        .filter((order) => {
            return order.orderNo
                && order.pendingQuantity > 0
                && (!normalizedStockCode || order.stockCode === normalizedStockCode);
        });
}

async function placeStockOrder(payload = {}, credentials = null) {
    const action = payload.action === 'sell' ? 'sell' : payload.action === 'buy' ? 'buy' : '';
    const priceMode = payload.priceMode === 'market' ? 'market' : 'limit';
    const stockCode = normalizeStockCode(payload.stockCode);
    const quantity = normalizeInteger(payload.quantity);
    const price = normalizeInteger(payload.price);

    if (!isRegularMarketTime()) {
        throw new Error('현재는 정규장 시간이 아닙니다. 정규장(09:00~15:30)에만 주문할 수 있습니다.');
    }
    if (!action) throw new Error('주문 구분을 선택하세요.');
    if (!stockCode) throw new Error('주문할 종목을 먼저 선택하세요.');
    if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('주문 수량을 1주 이상 입력하세요.');
    if (priceMode === 'limit' && (!Number.isInteger(price) || price <= 0)) {
        throw new Error('지정가 주문 가격을 입력하세요.');
    }
    const body = {
        dmst_stex_tp: payload.exchange || 'SOR',
        stk_cd: stockCode,
        ord_qty: String(quantity),
        ord_uv: priceMode === 'market' ? '' : String(price),
        trde_tp: priceMode === 'market' ? '3' : '0',
        cond_uv: '',
    };

    let result;
    try {
        result = await requestKiwoomTr(ORDER_API_IDS[action], body, ORDER_ENDPOINT, credentials);
    } catch (error) {
        throw new Error(normalizeOrderRejectionMessage(error, action));
    }

    const returnCode = Number(result.return_code ?? 0);
    if (returnCode !== 0) {
        throw new Error(normalizeOrderRejectionMessage(result.return_msg, action));
    }

    return {
        ok: true,
        action,
        priceMode,
        stockCode,
        quantity,
        price: priceMode === 'market' ? null : price,
        orderNo: result.ord_no || '',
        message: result.return_msg || '주문이 접수되었습니다.',
        raw: result,
    };
}

async function modifyStockOrder(payload = {}, credentials = null) {
    const originalOrderNo = normalizeText(payload.orderNo || payload.originalOrderNo);
    const stockCode = normalizeStockCode(payload.stockCode);
    const quantity = normalizeInteger(payload.quantity);
    const price = normalizeInteger(payload.price);

    if (!isRegularMarketTime()) {
        throw new Error('현재는 정규장 시간이 아닙니다. 정규장(09:00~15:30)에만 주문을 정정할 수 있습니다.');
    }
    if (!originalOrderNo) throw new Error('정정할 주문번호가 없습니다.');
    if (!stockCode) throw new Error('정정할 종목코드가 없습니다.');
    if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('정정 수량을 1주 이상 입력하세요.');
    if (!Number.isInteger(price) || price <= 0) throw new Error('정정 가격을 입력하세요.');

    const result = await requestKiwoomTr('kt10002', {
        dmst_stex_tp: payload.exchange || 'SOR',
        orig_ord_no: originalOrderNo,
        stk_cd: stockCode,
        mdfy_qty: String(quantity),
        mdfy_uv: String(price),
        mdfy_cond_uv: '',
    }, ORDER_ENDPOINT, credentials);

    const returnCode = Number(result.return_code ?? 0);
    if (returnCode !== 0) {
        throw new Error(result.return_msg || '정정 주문 요청이 거절되었습니다.');
    }

    return {
        ok: true,
        orderNo: result.ord_no || '',
        originalOrderNo,
        quantity,
        price,
        message: result.return_msg || '정정 주문이 접수되었습니다.',
        raw: result,
    };
}

async function cancelStockOrder(payload = {}, credentials = null) {
    const originalOrderNo = normalizeText(payload.orderNo || payload.originalOrderNo);
    const stockCode = normalizeStockCode(payload.stockCode);
    const quantity = normalizeInteger(payload.quantity);

    if (!isRegularMarketTime()) {
        throw new Error('현재는 정규장 시간이 아닙니다. 정규장(09:00~15:30)에만 주문을 취소할 수 있습니다.');
    }
    if (!originalOrderNo) throw new Error('취소할 주문번호가 없습니다.');
    if (!stockCode) throw new Error('취소할 종목코드가 없습니다.');
    if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('취소 수량을 1주 이상 입력하세요.');

    const result = await requestKiwoomTr('kt10003', {
        dmst_stex_tp: payload.exchange || 'SOR',
        orig_ord_no: originalOrderNo,
        stk_cd: stockCode,
        cncl_qty: String(quantity),
    }, ORDER_ENDPOINT, credentials);

    const returnCode = Number(result.return_code ?? 0);
    if (returnCode !== 0) {
        throw new Error(result.return_msg || '취소 주문 요청이 거절되었습니다.');
    }

    return {
        ok: true,
        orderNo: result.ord_no || '',
        originalOrderNo,
        quantity,
        message: result.return_msg || '취소 주문이 접수되었습니다.',
        raw: result,
    };
}

module.exports = {
    cancelStockOrder,
    getPendingOrders,
    isRegularMarketTime,
    modifyStockOrder,
    placeStockOrder,
};
