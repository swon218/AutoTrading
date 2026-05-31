import { getIndicatorColor, getIndicatorNumber, movingAverage } from './utils.js';

export default {
    key: 'ma',
    name: '이동평균선',
    aliases: ['이동평균', '이동평균선', 'ma', 'sma', 'ema'],
    description: '단기선과 장기선을 캔들 위에 표시합니다.',
    help: {
        title: '이동평균선',
        summary: '일정 기간의 평균 가격을 선으로 표시해서 가격 흐름과 추세 방향을 보기 쉽게 만드는 지표입니다.',
        parameters: [
            '종류: SMA는 단순평균, EMA는 최근 가격에 더 민감한 평균입니다.',
            '단기 기간: 빠르게 움직이는 평균선의 봉 개수입니다.',
            '장기 기간: 느리게 움직이는 평균선의 봉 개수입니다.',
        ],
        chart: '단기선이 장기선 위에 있으면 상승 흐름, 아래에 있으면 약세 흐름으로 참고합니다.',
        autoTrade: '현재 자동매매에서는 단기 이동평균선이 장기 이동평균선을 아래에서 위로 돌파하는 순간을 매수 신호로 봅니다.',
        caution: '가격보다 늦게 따라오는 지표라 급격한 변동 직후에는 반응이 늦을 수 있습니다.',
    },
    panel: 'overlay',
    fields: [
        { key: 'maType', label: '종류', type: 'select', value: 'sma', options: [
            { value: 'sma', label: 'SMA' },
            { value: 'ema', label: 'EMA' },
        ] },
        { key: 'short', label: '단기 기간', type: 'number', value: 5 },
        { key: 'long', label: '장기 기간', type: 'number', value: 20 },
        { key: 'shortColor', label: '단기선 색상', type: 'color', value: '#facc15' },
        { key: 'longColor', label: '장기선 색상', type: 'color', value: '#22d3ee' },
    ],
    getScaleSeries(indicator, candles) {
        const closes = candles.map((candle) => candle.close);
        const type = indicator.values.maType || 'sma';
        return [
            movingAverage(closes, getIndicatorNumber(indicator, 'short', 5), type),
            movingAverage(closes, getIndicatorNumber(indicator, 'long', 20), type),
        ];
    },
    drawOverlay(indicator, context) {
        const { ctx, closes, drawSeriesLine, padding } = context;
        const type = indicator.values.maType || 'sma';
        const shortPeriod = getIndicatorNumber(indicator, 'short', 5);
        const longPeriod = getIndicatorNumber(indicator, 'long', 20);
        const shortColor = getIndicatorColor(indicator, 'shortColor', '#facc15');
        const longColor = getIndicatorColor(indicator, 'longColor', '#22d3ee');

        drawSeriesLine(movingAverage(closes, shortPeriod, type), shortColor, 1.5);
        drawSeriesLine(movingAverage(closes, longPeriod, type), longColor, 1.5);

        ctx.fillStyle = shortColor;
        ctx.font = '11px Noto Sans KR, sans-serif';
        ctx.fillText(`MA ${shortPeriod}/${longPeriod}`, padding.left + 4, padding.top + 14);
    },
};
