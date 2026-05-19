import { getIndicatorColor, getIndicatorNumber, movingAverage } from './utils.js';

const calculateCci = (candles, period) => {
    const safePeriod = Math.max(1, Math.round(period));
    const typicalPrices = candles.map((candle) => (candle.high + candle.low + candle.close) / 3);
    const averages = movingAverage(typicalPrices, safePeriod, 'sma');

    return typicalPrices.map((typicalPrice, index) => {
        if (index < safePeriod - 1 || !Number.isFinite(averages[index])) return null;
        const slice = typicalPrices.slice(index - safePeriod + 1, index + 1);
        const meanDeviation = slice.reduce((sum, value) => sum + Math.abs(value - averages[index]), 0) / safePeriod;
        return meanDeviation === 0 ? 0 : (typicalPrice - averages[index]) / (0.015 * meanDeviation);
    });
};

export default {
    key: 'cci',
    name: 'CCI',
    aliases: ['cci', 'commodity channel index', '상품채널지수'],
    description: '현재 가격이 일정 기간 평균 가격에서 얼마나 벗어났는지 표시합니다.',
    panel: 'lower',
    fields: [
        { key: 'period', label: '기간', type: 'number', value: 20 },
        { key: 'lower', label: '하단값', type: 'number', value: 100 },
        { key: 'upper', label: '상단값', type: 'number', value: 100 },
        { key: 'lineColor', label: 'CCI선 색상', type: 'color', value: '#eab308' },
        { key: 'upperColor', label: '상단선 색상', type: 'color', value: '#f87171' },
        { key: 'lowerColor', label: '하단선 색상', type: 'color', value: '#60a5fa' },
    ],
    drawPanel(indicator, context) {
        const { ctx, candles, panel, drawSeriesLine, width, padding } = context;
        const period = getIndicatorNumber(indicator, 'period', 20);
        const upper = getIndicatorNumber(indicator, 'upper', 100);
        const lower = -getIndicatorNumber(indicator, 'lower', 100);
        const lineColor = getIndicatorColor(indicator, 'lineColor', '#eab308');
        const upperColor = getIndicatorColor(indicator, 'upperColor', '#f87171');
        const lowerColor = getIndicatorColor(indicator, 'lowerColor', '#60a5fa');
        const series = calculateCci(candles, period);
        const finiteValues = series.filter((value) => Number.isFinite(value));
        const maxValue = Math.max(upper, 120, ...finiteValues);
        const minValue = Math.min(lower, -120, ...finiteValues);
        const range = Math.max(1, maxValue - minValue);
        const yForValue = (value) => panel.bottom - ((value - minValue) / range) * panel.height;

        [
            { value: upper, color: upperColor },
            { value: lower, color: lowerColor },
            { value: 0, color: 'rgba(226, 232, 240, 0.32)' },
        ].forEach((level) => {
            const y = yForValue(level.value);
            ctx.setLineDash(level.value === 0 ? [] : [4, 4]);
            ctx.strokeStyle = level.color;
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(width - padding.right, y);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = '#cbd5e1';
            ctx.fillText(String(level.value), width - padding.right + 8, y + 4);
        });

        drawSeriesLine(series, lineColor, 1.5, yForValue);
        ctx.fillStyle = lineColor;
        ctx.fillText(`CCI ${period}`, padding.left + 4, panel.top + 14);
    },
};
