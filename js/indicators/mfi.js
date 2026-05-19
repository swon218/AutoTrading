import { getIndicatorColor, getIndicatorNumber, normalizeIndicatorValues } from './utils.js';

const calculateMfi = (candles, period) => {
    const result = Array(candles.length).fill(null);
    const safePeriod = Math.max(1, Math.round(period));
    const positiveFlow = Array(candles.length).fill(0);
    const negativeFlow = Array(candles.length).fill(0);

    for (let i = 1; i < candles.length; i += 1) {
        const typical = (candles[i].high + candles[i].low + candles[i].close) / 3;
        const previousTypical = (candles[i - 1].high + candles[i - 1].low + candles[i - 1].close) / 3;
        const moneyFlow = typical * (candles[i].volume || 0);

        if (typical > previousTypical) {
            positiveFlow[i] = moneyFlow;
        } else if (typical < previousTypical) {
            negativeFlow[i] = moneyFlow;
        }
    }

    for (let i = safePeriod; i < candles.length; i += 1) {
        const positive = positiveFlow.slice(i - safePeriod + 1, i + 1).reduce((sum, value) => sum + value, 0);
        const negative = negativeFlow.slice(i - safePeriod + 1, i + 1).reduce((sum, value) => sum + value, 0);
        result[i] = negative === 0 ? 100 : 100 - (100 / (1 + positive / negative));
    }

    return result;
};

export default {
    key: 'mfi',
    name: 'MFI',
    aliases: ['mfi', '자금흐름지수', '거래량지표'],
    description: '가격과 거래량을 함께 보는 자금흐름 지표입니다.',
    panel: 'lower',
    fields: [
        { key: 'period', label: '기간', type: 'number', value: 14 },
        { key: 'lower', label: '하단값', type: 'number', value: 20 },
        { key: 'upper', label: '상단값', type: 'number', value: 80 },
        { key: 'lineColor', label: 'MFI선 색상', type: 'color', value: '#10b981' },
        { key: 'upperColor', label: '상단선 색상', type: 'color', value: '#f87171' },
        { key: 'lowerColor', label: '하단선 색상', type: 'color', value: '#60a5fa' },
    ],
    drawPanel(indicator, context) {
        const { ctx, candles, panel, drawSeriesLine, width, padding } = context;
        const values = normalizeIndicatorValues(indicator.key, indicator.values);
        const period = getIndicatorNumber(indicator, 'period', 14);
        const lower = Number(values.lower ?? 20);
        const upper = Number(values.upper ?? 80);
        const lineColor = getIndicatorColor(indicator, 'lineColor', '#10b981');
        const upperColor = getIndicatorColor(indicator, 'upperColor', '#f87171');
        const lowerColor = getIndicatorColor(indicator, 'lowerColor', '#60a5fa');
        const series = calculateMfi(candles, period);
        const yForValue = (value) => panel.bottom - (Math.max(0, Math.min(100, value)) / 100) * panel.height;

        [upper, lower].forEach((level) => {
            const y = yForValue(level);
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = level >= 50 ? upperColor : lowerColor;
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(width - padding.right, y);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = '#cbd5e1';
            ctx.fillText(String(level), width - padding.right + 8, y + 4);
        });

        drawSeriesLine(series, lineColor, 1.5, yForValue);
        ctx.fillStyle = lineColor;
        ctx.fillText(`MFI ${period}`, padding.left + 4, panel.top + 14);
    },
};
