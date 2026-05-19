import { getIndicatorColor, getIndicatorNumber, movingAverage } from './utils.js';

export default {
    key: 'ma',
    name: '이동평균선',
    aliases: ['이동평균', '이동평균선', 'ma', 'sma', 'ema'],
    description: '단기선과 장기선을 캔들 위에 표시합니다.',
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
