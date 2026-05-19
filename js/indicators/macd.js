import { getIndicatorColor, getIndicatorNumber, movingAverage } from './utils.js';

const calculateMacd = (closes, fast, slow, signal) => {
    const fastEma = movingAverage(closes, fast, 'ema');
    const slowEma = movingAverage(closes, slow, 'ema');
    const macd = closes.map((_, index) => {
        return fastEma[index] === null || slowEma[index] === null ? null : fastEma[index] - slowEma[index];
    });
    const signalLine = movingAverage(macd.map((value) => value ?? 0), signal, 'ema')
        .map((value, index) => (macd[index] === null ? null : value));
    const histogram = macd.map((value, index) => {
        return value === null || signalLine[index] === null ? null : value - signalLine[index];
    });

    return { macd, signalLine, histogram };
};

export default {
    key: 'macd',
    name: 'MACD',
    aliases: ['macd', '엠에이씨디'],
    description: 'MACD와 시그널선의 교차를 확인합니다.',
    panel: 'lower',
    fields: [
        { key: 'fast', label: '단기 EMA', type: 'number', value: 12 },
        { key: 'slow', label: '장기 EMA', type: 'number', value: 26 },
        { key: 'signal', label: 'Signal', type: 'number', value: 9 },
        { key: 'macdColor', label: 'MACD선 색상', type: 'color', value: '#f97316' },
        { key: 'signalColor', label: 'Signal선 색상', type: 'color', value: '#38bdf8' },
        { key: 'positiveColor', label: '양봉 막대 색상', type: 'color', value: '#ef4444' },
        { key: 'negativeColor', label: '음봉 막대 색상', type: 'color', value: '#3b82f6' },
    ],
    drawPanel(indicator, context) {
        const { ctx, closes, panel, drawSeriesLine, width, padding, bodyWidth, xForIndex } = context;
        const fast = getIndicatorNumber(indicator, 'fast', 12);
        const slow = getIndicatorNumber(indicator, 'slow', 26);
        const signal = getIndicatorNumber(indicator, 'signal', 9);
        const macdColor = getIndicatorColor(indicator, 'macdColor', '#f97316');
        const signalColor = getIndicatorColor(indicator, 'signalColor', '#38bdf8');
        const positiveColor = getIndicatorColor(indicator, 'positiveColor', '#ef4444');
        const negativeColor = getIndicatorColor(indicator, 'negativeColor', '#3b82f6');
        const macdData = calculateMacd(closes, fast, slow, signal);
        const allValues = [macdData.macd, macdData.signalLine, macdData.histogram]
            .flat()
            .filter((value) => Number.isFinite(value));
        const minMacd = allValues.length ? Math.min(0, ...allValues) : -1;
        const maxMacd = allValues.length ? Math.max(0, ...allValues) : 1;
        const macdRange = Math.max(1, maxMacd - minMacd);
        const yForValue = (value) => panel.bottom - ((value - minMacd) / macdRange) * panel.height;
        const zeroY = yForValue(0);

        ctx.strokeStyle = 'rgba(226, 232, 240, 0.32)';
        ctx.beginPath();
        ctx.moveTo(padding.left, zeroY);
        ctx.lineTo(width - padding.right, zeroY);
        ctx.stroke();

        macdData.histogram.forEach((value, index) => {
            if (!Number.isFinite(value)) return;
            const x = xForIndex(index);
            const y = yForValue(value);
            ctx.fillStyle = value >= 0 ? positiveColor : negativeColor;
            ctx.fillRect(x - bodyWidth / 2, Math.min(y, zeroY), bodyWidth, Math.max(1, Math.abs(zeroY - y)));
        });

        drawSeriesLine(macdData.macd, macdColor, 1.4, yForValue);
        drawSeriesLine(macdData.signalLine, signalColor, 1.4, yForValue);
        ctx.fillStyle = macdColor;
        ctx.fillText(`MACD ${fast}/${slow}/${signal}`, padding.left + 4, panel.top + 14);
        ctx.fillStyle = '#cbd5e1';
        ctx.fillText(maxMacd.toFixed(1), width - padding.right + 8, panel.top + 12);
        ctx.fillText(minMacd.toFixed(1), width - padding.right + 8, panel.bottom + 4);
    },
};
