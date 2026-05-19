import { getIndicatorColor, getIndicatorNumber, movingAverage } from './utils.js';

const calculateTrueRange = (candles) => {
    return candles.map((candle, index) => {
        if (index === 0) return candle.high - candle.low;
        const previousClose = candles[index - 1].close;
        return Math.max(
            candle.high - candle.low,
            Math.abs(candle.high - previousClose),
            Math.abs(candle.low - previousClose),
        );
    });
};

export default {
    key: 'atr',
    name: 'ATR',
    aliases: ['atr', 'average true range', '평균진폭', '변동성'],
    description: '고가/저가/전일종가를 이용해 평균 변동폭을 표시합니다.',
    panel: 'lower',
    fields: [
        { key: 'period', label: '기간', type: 'number', value: 14 },
        { key: 'lineColor', label: 'ATR선 색상', type: 'color', value: '#fb7185' },
    ],
    drawPanel(indicator, context) {
        const { ctx, candles, panel, drawSeriesLine, width, padding } = context;
        const period = getIndicatorNumber(indicator, 'period', 14);
        const lineColor = getIndicatorColor(indicator, 'lineColor', '#fb7185');
        const series = movingAverage(calculateTrueRange(candles), period, 'sma');
        const finiteValues = series.filter((value) => Number.isFinite(value));
        const maxValue = Math.max(1, ...finiteValues);
        const yForValue = (value) => panel.bottom - (Math.max(0, value) / maxValue) * panel.height;

        drawSeriesLine(series, lineColor, 1.5, yForValue);
        ctx.fillStyle = lineColor;
        ctx.fillText(`ATR ${period}`, padding.left + 4, panel.top + 14);
        ctx.fillStyle = '#cbd5e1';
        ctx.fillText(Math.round(maxValue).toLocaleString('ko-KR'), width - padding.right + 8, panel.top + 12);
        ctx.fillText('0', width - padding.right + 8, panel.bottom + 4);
    },
};
