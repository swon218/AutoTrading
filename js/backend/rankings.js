const { requestKiwoomTr } = require('./kiwoomAuth');
const { absoluteNumber, signedNumber, todayYmd } = require('./kiwoomUtils');

const RANKING_TYPES = {
    realtime: {
        label: '실시간조회',
        apiId: 'ka00198',
        endpoint: '/api/dostk/stkinfo',
        body: { qry_tp: '5' },
        listKeys: ['item_inq_rank'],
        metricLabel: '조회순위',
    },
    gainers: {
        label: '상승률',
        apiId: 'ka10027',
        endpoint: '/api/dostk/rkinfo',
        body: {
            mrkt_tp: '000',
            sort_tp: '1',
            trde_qty_cnd: '0000',
            stk_cnd: '0',
            crd_cnd: '0',
            updown_incls: '1',
            pric_cnd: '0',
            trde_prica_cnd: '0',
            stex_tp: '3',
        },
        listKeys: ['pred_pre_flu_rt_upper'],
        metricLabel: '등락률',
    },
    losers: {
        label: '하락률',
        apiId: 'ka10027',
        endpoint: '/api/dostk/rkinfo',
        body: {
            mrkt_tp: '000',
            sort_tp: '3',
            trde_qty_cnd: '0000',
            stk_cnd: '0',
            crd_cnd: '0',
            updown_incls: '1',
            pric_cnd: '0',
            trde_prica_cnd: '0',
            stex_tp: '3',
        },
        listKeys: ['pred_pre_flu_rt_upper'],
        metricLabel: '등락률',
    },
    volume: {
        label: '거래량 상위',
        apiId: 'ka10030',
        endpoint: '/api/dostk/rkinfo',
        body: {
            mrkt_tp: '000',
            sort_tp: '1',
            mang_stk_incls: '0',
            crd_tp: '0',
            trde_qty_tp: '0',
            pric_tp: '0',
            trde_prica_tp: '0',
            mrkt_open_tp: '0',
            stex_tp: '3',
        },
        listKeys: ['tdy_trde_qty_upper'],
        metricLabel: '거래량',
    },
    volumeSpike: {
        label: '거래량 급증',
        apiId: 'ka10023',
        endpoint: '/api/dostk/rkinfo',
        body: {
            mrkt_tp: '000',
            sort_tp: '1',
            tm_tp: '2',
            trde_qty_tp: '5',
            tm: '',
            stk_cnd: '0',
            pric_tp: '0',
            stex_tp: '3',
        },
        listKeys: ['trde_qty_sdnin'],
        metricLabel: '급증률',
    },
    domesticTradeTop: {
        label: '개인/기관 매매상위',
        apiId: 'ka10065',
        endpoint: '/api/dostk/rkinfo',
        body: {
            mrkt_tp: '000',
            trde_tp: '1',
            orgn_tp: '9999',
        },
        listKeys: ['opmr_invsr_trde_upper', 'opaf_invsr_trde'],
        metricLabel: '순매수',
    },
    foreignInstitutionTop: {
        label: '외국인/기관 매매상위',
        apiId: 'ka90009',
        endpoint: '/api/dostk/rkinfo',
        body: {
            mrkt_tp: '000',
            amt_qty_tp: '1',
            qry_dt_tp: '0',
            invsr: '6',
            frgn_all: '0',
            smtm_netprps_tp: '0',
            stex_tp: '3',
        },
        listKeys: ['frgnr_orgn_trde_upper', 'opmr_invsr_trde', 'for_dt_trde_upper'],
        metricLabel: '순매수',
    },
    sector: {
        label: '섹터상위',
        apiId: 'ka20003',
        endpoint: '/api/dostk/sect',
        body: { inds_cd: '001' },
        listKeys: ['all_inds_idx', 'inds_idx', 'inds_stkpc'],
        metricLabel: '등락률',
    },
};

async function requestRankingItems(type, limit, bodyOverride = {}, credentials = null) {
    const config = RANKING_TYPES[type] || RANKING_TYPES.realtime;
    const payload = await requestKiwoomTr(config.apiId, {
        ...config.body,
        ...bodyOverride,
    }, config.endpoint, credentials);

    if (payload.return_code !== 0) {
        throw new Error(payload.return_msg || `Ranking request failed: ${JSON.stringify(payload)}`);
    }

    return getFirstList(payload, config.listKeys)
        .map((item, index) => normalizeRankingItem(item, index, type))
        .filter((item) => item.name)
        .slice(0, limit);
}

function cleanCode(value) {
    return String(value || '')
        .replace(/^A/i, '')
        .replace(/_.+$/, '')
        .trim();
}

function cleanText(value) {
    return String(value ?? '').replace(/^[+-]/, '').trim();
}

function getFirstList(payload, keys) {
    for (const key of keys) {
        if (Array.isArray(payload[key])) return payload[key];
    }

    const firstArray = Object.values(payload).find(Array.isArray);
    return firstArray || [];
}

function pickMetric(item, type) {
    if (type === 'realtime') {
        return item.bigd_rank || item.rank || item.rank_chg || '';
    }
    if (type === 'volume') {
        return item.trde_qty || item.now_trde_qty || item.acc_trde_qty || '';
    }
    if (type === 'volumeSpike') {
        return item.sdnin_rt || item.sdnin_qty || '';
    }
    if (type === 'domesticTradeTop') {
        return item.netslmt || item.buy_qty || item.sel_qty || '';
    }
    if (type === 'foreignInstitutionTop') {
        return item.netprps_qty || item.netprps_amt || item.trde_qty || item.gain_pos_stkcnt || '';
    }
    return item.flu_rt || item.pred_pre || item.pre || '';
}

function getRealtimeDirection(item) {
    const sign = String(item.base_comp_sign || item.prev_base_sign || '').trim();
    if (sign === '1' || sign === '2') return 'up';
    if (sign === '4' || sign === '5') return 'down';

    const changeRate = signedNumber(item.base_comp_chgr || item.prev_base_chgr);
    return changeRate > 0 ? 'up' : changeRate < 0 ? 'down' : 'flat';
}

function normalizeRankingItem(item, index, type) {
    const price = type === 'realtime'
        ? absoluteNumber(item.past_curr_prc)
        : absoluteNumber(item.cur_prc);
    const change = signedNumber(item.pred_pre || item.pre || item.prid_stkpc_flu);
    const changeRate = type === 'realtime'
        ? signedNumber(item.base_comp_chgr || item.prev_base_chgr)
        : signedNumber(item.flu_rt || item.tdy_close_pric_flu_rt);
    const code = cleanCode(
        item.stk_cd
        || item.stk_code
        || item.stock_code
        || item.code
        || item.isu_cd
        || item.inds_cd,
    );
    const name = String(
        item.stk_nm
        || item.stk_name
        || item.stock_name
        || item.name
        || item.isu_nm
        || item.inds_nm
        || '',
    ).trim();

    return {
        rank: cleanText(item.rank || item.bigd_rank || index + 1),
        code,
        name,
        price,
        change,
        changeRate,
        volume: absoluteNumber(item.trde_qty || item.now_trde_qty || item.acc_trde_qty || item.prid_trde_qty),
        metric: type === 'realtime' ? '' : cleanText(pickMetric(item, type)),
        direction: type === 'realtime'
            ? getRealtimeDirection(item)
            : changeRate > 0 || change > 0 ? 'up' : changeRate < 0 || change < 0 ? 'down' : 'flat',
    };
}

function normalizeForeignInstitutionItems(rows, limit) {
    const items = [];

    for (const row of rows) {
        const candidates = [
            {
                label: '외국인',
                code: row.for_netprps_stk_cd,
                name: row.for_netprps_stk_nm,
                amount: row.for_netprps_amt,
                quantity: row.for_netprps_qty,
            },
            {
                label: '기관',
                code: row.orgn_netprps_stk_cd,
                name: row.orgn_netprps_stk_nm,
                amount: row.orgn_netprps_amt,
                quantity: row.orgn_netprps_qty,
            },
        ];

        for (const candidate of candidates) {
            const code = cleanCode(candidate.code);
            const name = String(candidate.name || '').trim();
            if (!code || !name) continue;

            items.push({
                rank: items.length + 1,
                code,
                name,
                price: null,
                change: null,
                changeRate: null,
                volume: absoluteNumber(candidate.quantity),
                metric: `${candidate.label} ${cleanText(candidate.amount)}`,
                direction: 'flat',
            });

            if (items.length >= limit) return items;
        }
    }

    return items;
}

async function getHomeRanking(type = 'realtime', limit = 10, credentials = null) {
    const normalizedLimit = Math.max(1, Math.min(Number(limit) || 10, 30));
    if (type === 'movers') {
        const [gainers, losers] = await Promise.all([
            requestRankingItems('gainers', normalizedLimit, {}, credentials),
            requestRankingItems('losers', normalizedLimit, {}, credentials),
        ]);

        return {
            type,
            label: '상승률/하락률',
            apiId: 'ka10027',
            metricLabel: '등락률',
            date: todayYmd(),
            groups: {
                gainers,
                losers,
            },
            items: [...gainers, ...losers],
        };
    }

    if (type === 'foreignInstitutionTop') {
        const config = RANKING_TYPES.foreignInstitutionTop;
        const payload = await requestKiwoomTr(config.apiId, config.body, config.endpoint, credentials);

        if (payload.return_code !== 0) {
            throw new Error(payload.return_msg || `Ranking request failed: ${JSON.stringify(payload)}`);
        }

        return {
            type,
            label: RANKING_TYPES.foreignInstitutionTop.label,
            apiId: RANKING_TYPES.foreignInstitutionTop.apiId,
            metricLabel: RANKING_TYPES.foreignInstitutionTop.metricLabel,
            date: todayYmd(),
            items: normalizeForeignInstitutionItems(getFirstList(payload, config.listKeys), normalizedLimit),
        };
    }

    const config = RANKING_TYPES[type] || RANKING_TYPES.realtime;
    const items = await requestRankingItems(type, normalizedLimit, {}, credentials);

    return {
        type,
        label: config.label,
        apiId: config.apiId,
        metricLabel: config.metricLabel,
        date: todayYmd(),
        items,
    };
}

module.exports = {
    RANKING_TYPES,
    getHomeRanking,
};
