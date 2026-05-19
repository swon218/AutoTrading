import { getIndicatorColor, getIndicatorNumber, movingAverage } from './utils.js';

const calculateStochastic = (candles, period, smooth, signal) => {
    const safePeriod = Math.max(1, Math.round(period));
    const rawK = Array(candles.length).fill(null);

    for (let index = safePeriod - 1; index < candles.length; index += 1) {
        const slice = candles.slice(index - safePeriod + 1, index + 1);
        const high = Math.max(...slice.map((candle) => candle.high));
        const low = Math.min(...slice.map((candle) => candle.low));
        rawK[index] = high === low ? 50 : ((candles[index].close - low) / (high - low)) * 100;
    }

    const k = movingAverage(rawK.map((value) => value ?? 0), smooth, 'sma')
        .map((value, index) => (rawK[index] === null ? null : value));
    const d = movingAverage(k.map((value) => value ?? 0), signal, 'sma')
        .map((value, index) => (k[index] === null ? null : value));

    return { k, d };
};

export default {
    key: 'stochastic',
    name: '스토캐스틱',
    aliases: ['스토캐스틱', 'stochastic', 'slow stochastic', 'fast stochastic', 'stoch'],
    description: '최근 고가/저가 범위에서 현재 종가 위치를 %K/%D로 표시합니다.',
    panel: 'lower',
    fields: [
        { key: 'period', label: '%K 기간', type: 'number', value: 14 },
        { key: 'smooth', label: '%K 평활', type: 'number', value: 3 },
        { key: 'signal', label: '%D 기간', type: 'number', value: 3 },
        { key: 'lower', label: '하단값', type: 'number', value: 20 },
        { key: 'upper', label: '상단값', type: 'number', value: 80 },
        { key: 'kColor', label: '%K 색상', type: 'color', value: '#f97316' },
        { key: 'dColor', label: '%D 색상', type: 'color', value: '#38bdf8' },
        { key: 'upperColor', label: '상단선 색상', type: 'color', value: '#f87171' },
        { key: 'lowerColor', label: '하단선 색상', type: 'color', value: '#60a5fa' },
    ],
    drawPanel(indicator, context) {
        const { ctx, candles, panel, drawSeriesLine, width, padding } = context;
        const period = getIndicatorNumber(indicator, 'period', 14);
        const smooth = getIndicatorNumber(indicator, 'smooth', 3);
        const signal = getIndicatorNumber(indicator, 'signal', 3);
        const lower = getIndicatorNumber(indicator, 'lower', 20);
        const upper = getIndicatorNumber(indicator, 'upper', 80);
        const kColor = getIndicatorColor(indicator, 'kColor', '#f97316');
        const dColor = getIndicatorColor(indicator, 'dColor', '#38bdf8');
        const upperColor = getIndicatorColor(indicator, 'upperColor', '#f87171');
        const lowerColor = getIndicatorColor(indicator, 'lowerColor', '#60a5fa');
        const { k, d } = calculateStochastic(candles, period, smooth, signal);
        const yForValue = (value) => panel.bottom - (Math.max(0, Math.min(100, value)) / 100) * panel.height;

        [
            { value: upper, color: upperColor },
            { value: lower, color: lowerColor },
        ].forEach((level) => {
            const y = yForValue(level.value);
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = level.color;
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(width - padding.right, y);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = '#cbd5e1';
            ctx.fillText(String(level.value), width - padding.right + 8, y + 4);
        });

        drawSeriesLine(k, kColor, 1.4, yForValue);
        drawSeriesLine(d, dColor, 1.4, yForValue);
        ctx.fillStyle = kColor;
        ctx.fillText(`Stoch ${period}/${smooth}/${signal}`, padding.left + 4, panel.top + 14);
    },
};
