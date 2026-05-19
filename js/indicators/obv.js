import { getIndicatorColor, getIndicatorNumber, movingAverage } from './utils.js';

const calculateObv = (candles) => {
    const result = Array(candles.length).fill(0);

    for (let index = 1; index < candles.length; index += 1) {
        const previous = candles[index - 1];
        const current = candles[index];
        const volume = current.volume || 0;
        if (current.close > previous.close) {
            result[index] = result[index - 1] + volume;
        } else if (current.close < previous.close) {
            result[index] = result[index - 1] - volume;
        } else {
            result[index] = result[index - 1];
        }
    }

    return result;
};

export default {
    key: 'obv',
    name: 'OBV',
    aliases: ['obv', 'on balance volume', '거래량잔고'],
    description: '상승일 거래량은 더하고 하락일 거래량은 빼서 거래량 흐름을 표시합니다.',
    panel: 'lower',
    fields: [
        { key: 'average', label: '평균 기간', type: 'number', value: 9 },
        { key: 'lineColor', label: 'OBV선 색상', type: 'color', value: '#14b8a6' },
        { key: 'averageColor', label: '평균선 색상', type: 'color', value: '#f59e0b' },
    ],
    drawPanel(indicator, context) {
        const { ctx, candles, panel, drawSeriesLine, width, padding } = context;
        const average = getIndicatorNumber(indicator, 'average', 9);
        const lineColor = getIndicatorColor(indicator, 'lineColor', '#14b8a6');
        const averageColor = getIndicatorColor(indicator, 'averageColor', '#f59e0b');
        const series = calculateObv(candles);
        const averageSeries = movingAverage(series, average, 'sma');
        const finiteValues = series.concat(averageSeries).filter((value) => Number.isFinite(value));
        const maxValue = finiteValues.length ? Math.max(...finiteValues) : 1;
        const minValue = finiteValues.length ? Math.min(...finiteValues) : -1;
        const range = Math.max(1, maxValue - minValue);
        const yForValue = (value) => panel.bottom - ((value - minValue) / range) * panel.height;
        const zeroY = yForValue(0);

        if (zeroY >= panel.top && zeroY <= panel.bottom) {
            ctx.strokeStyle = 'rgba(226, 232, 240, 0.32)';
            ctx.beginPath();
            ctx.moveTo(padding.left, zeroY);
            ctx.lineTo(width - padding.right, zeroY);
            ctx.stroke();
        }

        drawSeriesLine(series, lineColor, 1.5, yForValue);
        drawSeriesLine(averageSeries, averageColor, 1.2, yForValue);
        ctx.fillStyle = lineColor;
        ctx.fillText(`OBV ${average}`, padding.left + 4, panel.top + 14);
        ctx.fillStyle = '#cbd5e1';
        ctx.fillText(maxValue.toLocaleString('ko-KR'), width - padding.right + 8, panel.top + 12);
        ctx.fillText(minValue.toLocaleString('ko-KR'), width - padding.right + 8, panel.bottom + 4);
    },
};
