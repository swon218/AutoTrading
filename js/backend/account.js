const { requestKiwoomTr } = require('./kiwoomAuth');

const ACCOUNT_ENDPOINT = '/api/dostk/acnt';

function parseKiwoomAmount(value) {
    const normalized = String(value ?? '').replace(/[^\d.-]/g, '');
    const amount = Number(normalized);
    return Number.isFinite(amount) ? amount : 0;
}

function pickAmount(payload, keys) {
    for (const key of keys) {
        if (payload[key] !== undefined && payload[key] !== null && payload[key] !== '') {
            return parseKiwoomAmount(payload[key]);
        }
    }
    return 0;
}

function pickText(payload, keys) {
    for (const key of keys) {
        if (payload[key] !== undefined && payload[key] !== null && payload[key] !== '') {
            return String(payload[key]).trim();
        }
    }
    return '';
}

function pickRate(payload, keys) {
    const text = pickText(payload, keys).replace(/%/g, '');
    const rate = Number(text.replace(/[^\d.-]/g, ''));
    return Number.isFinite(rate) ? rate : 0;
}

const normalizeStockCode = (value) => {
    const code = String(value || '').replace(/[^A-Za-z0-9]/g, '').trim();
    return /^A\d{6}$/i.test(code) ? code.slice(1) : code;
};

function pickList(payload, keys) {
    for (const key of keys) {
        if (Array.isArray(payload[key])) return payload[key];
    }
    return [];
}

function normalizeHoldingItem(item = {}) {
    const stockCode = normalizeStockCode(item.stk_cd || item.stockCode || item.code);
    const holdingQuantity = pickAmount(item, [
        'rmnd_qty',
        'hold_qty',
        'poss_qty',
        'evltv_prft_qty',
        'holdingQuantity',
        'quantity',
    ]);
    const orderableQuantity = pickAmount(item, [
        'trde_able_qty',
        'ord_psbl_qty',
        'sell_psbl_qty',
        'able_qty',
        'orderableQuantity',
    ]) || holdingQuantity;
    const currentPrice = Math.abs(pickAmount(item, ['cur_prc', 'now_prc', 'cur_price', 'currentPrice']));
    const averagePrice = pickAmount(item, [
        'pchs_avg_pric',
        'avg_prc',
        'buy_avg_prc',
        'pchs_pric',
        'pur_pric',
        'buy_price',
        'averagePrice',
    ]);
    let purchaseAmount = pickAmount(item, ['pchs_amt', 'pur_amt', 'buy_amt', 'purchaseAmount'])
        || averagePrice * holdingQuantity;
    const evaluationAmount = pickAmount(item, ['evlt_amt', 'eval_amt', 'evaluationAmount'])
        || currentPrice * holdingQuantity;
    const commissionAmount = pickAmount(item, ['sum_cmsn', 'cmsn', 'pur_cmsn', 'sell_cmsn', 'commissionAmount']);
    const taxAmount = pickAmount(item, ['tax', 'tax_amt', 'taxAmount']);
    const profitLoss = pickAmount(item, ['evltv_prft', 'evlt_prft', 'profitLoss'])
        || evaluationAmount - purchaseAmount;
    if (!purchaseAmount && evaluationAmount && profitLoss) {
        purchaseAmount = evaluationAmount - profitLoss;
    }
    const profitRate = pickRate(item, ['prft_rt', 'evltv_prft_rt', 'profitRate']);

    return {
        stockCode,
        stockName: String(item.stk_nm || item.stockName || '').trim(),
        quantity: orderableQuantity,
        holdingQuantity,
        orderableQuantity,
        currentPrice,
        averagePrice,
        purchaseAmount,
        evaluationAmount,
        commissionAmount,
        taxAmount,
        profitLoss,
        profitRate,
        raw: item,
    };
}

async function getOrderableCash(credentials = null) {
    const payload = await requestKiwoomTr('kt00001', { qry_tp: '3' }, ACCOUNT_ENDPOINT, credentials);
    const hasErrorCode = payload.return_code !== undefined && payload.return_code !== null && payload.return_code !== '';
    const returnCode = Number(payload.return_code);
    if (hasErrorCode && Number.isFinite(returnCode) && returnCode !== 0) {
        throw new Error(payload.return_msg || '계좌 주문 가능 금액을 조회하지 못했습니다.');
    }
    if (payload.return_msg && /오류|실패|불가|거부|error/i.test(String(payload.return_msg))) {
        throw new Error(payload.return_msg);
    }

    const orderableAmount = pickAmount(payload, [
        'ord_alow_amt',
        'ord_psbl_amt',
        'ord_poss_amt',
        'ord_avl_amt',
        'buy_ord_psbl_amt',
        '주문가능금액',
    ]);

    return {
        orderableAmount,
        depositAmount: pickAmount(payload, ['entr', 'dps_amt', 'depositAmount', '예수금']),
        withdrawalAmount: pickAmount(payload, ['pymn_alow_amt', 'wdal_psbl_amt', 'withdrawalAmount', '출금가능금액']),
        raw: payload,
    };
}

async function getStockHolding(stockCode = '', credentials = null) {
    const normalizedStockCode = normalizeStockCode(stockCode);
    if (!normalizedStockCode) {
        throw new Error('보유 수량을 조회할 종목을 먼저 선택하세요.');
    }

    const payload = await requestKiwoomTr('kt00018', {
        qry_tp: '1',
        dmst_stex_tp: 'KRX',
    }, ACCOUNT_ENDPOINT, credentials);

    const returnCode = Number(payload.return_code ?? 0);
    if (Number.isFinite(returnCode) && returnCode !== 0) {
        throw new Error(payload.return_msg || '보유 수량을 조회하지 못했습니다.');
    }

    const holdings = pickList(payload, [
        'acnt_evlt_remn_indv_tot',
        'stk_acnt_evlt_prst',
        'acnt_prft_rt',
        'holdings',
    ]).map(normalizeHoldingItem);
    const holding = holdings.find((item) => item.stockCode === normalizedStockCode);

    return holding || {
        stockCode: normalizedStockCode,
        stockName: '',
        quantity: 0,
        holdingQuantity: 0,
        orderableQuantity: 0,
        currentPrice: 0,
        raw: null,
    };
}

async function getPortfolio(credentials = null) {
    const payload = await requestKiwoomTr('kt00018', {
        qry_tp: '1',
        dmst_stex_tp: 'KRX',
    }, ACCOUNT_ENDPOINT, credentials);

    const returnCode = Number(payload.return_code ?? 0);
    if (Number.isFinite(returnCode) && returnCode !== 0) {
        throw new Error(payload.return_msg || '보유 종목을 조회하지 못했습니다.');
    }

    const holdings = pickList(payload, [
        'acnt_evlt_remn_indv_tot',
        'stk_acnt_evlt_prst',
        'acnt_prft_rt',
        'holdings',
    ])
        .map(normalizeHoldingItem)
        .filter((item) => item.stockCode || item.stockName || item.holdingQuantity > 0);

    const reducedPurchaseAmount = holdings.reduce((sum, item) => sum + (item.purchaseAmount || 0), 0);
    const reducedEvaluationAmount = holdings.reduce((sum, item) => sum + (item.evaluationAmount || 0), 0);
    const reducedProfitLoss = holdings.reduce((sum, item) => sum + (item.profitLoss || 0), 0);
    const totalPurchaseAmount = pickAmount(payload, ['tot_pchs_amt', 'totalPurchaseAmount']) || reducedPurchaseAmount;
    const totalEvaluationAmount = pickAmount(payload, ['tot_evlt_amt', 'totalEvaluationAmount']) || reducedEvaluationAmount;
    const totalProfitLoss = pickAmount(payload, ['tot_evltv_prft', 'totalProfitLoss']) || reducedProfitLoss;
    const totalProfitRate = pickRate(payload, ['tot_prft_rt', 'totalProfitRate'])
        || (totalPurchaseAmount ? (totalProfitLoss / totalPurchaseAmount) * 100 : 0);

    let cash = null;
    try {
        cash = await getOrderableCash(credentials);
    } catch {
        cash = null;
    }

    return {
        holdings,
        summary: {
            totalPurchaseAmount,
            totalEvaluationAmount,
            totalProfitLoss,
            totalProfitRate,
            orderableAmount: cash?.orderableAmount ?? null,
            depositAmount: cash?.depositAmount ?? null,
        },
        raw: payload,
    };
}

module.exports = {
    getPortfolio,
    getStockHolding,
    getOrderableCash,
    parseKiwoomAmount,
};
