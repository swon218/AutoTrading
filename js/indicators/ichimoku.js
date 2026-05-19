import { getIndicatorColor, getIndicatorNumber } from './utils.js';

const midpoint = (candles, index, period) => {
    if (index < period - 1) return null;
    const slice = candles.slice(index - period + 1, index + 1);
    const high = Math.max(...slice.map((candle) => candle.high));
    const low = Math.min(...slice.map((candle) => candle.low));
    return (high + low) / 2;
};

const calculateIchimoku = (candles, conversionPeriod, basePeriod, spanBPeriod) => {
    const conversion = candles.map((_, index) => midpoint(candles, index, conversionPeriod));
    const base = candles.map((_, index) => midpoint(candles, index, basePeriod));
    const spanA = candles.map((_, index) => {
        if (!Number.isFinite(conversion[index]) || !Number.isFinite(base[index])) return null;
        return (conversion[index] + base[index]) / 2;
    });
    const spanB = candles.map((_, index) => midpoint(candles, index, spanBPeriod));
    const lagging = candles.map((candle) => candle.close);

    return { conversion, base, spanA, spanB, lagging };
};

export default {
    key: 'ichimoku',
    name: '일목균형표',
    aliases: ['일목균형표', '일목', 'ichimoku', 'ichimoku cloud'],
    description: '전환선, 기준선, 선행스팬, 후행스팬으로 추세와 지지/저항을 표시합니다.',
    panel: 'overlay',
    fields: [
        { key: 'conversion', label: '전환선', type: 'number', value: 9 },
        { key: 'base', label: '기준선', type: 'number', value: 26 },
        { key: 'spanB', label: '선행스팬B', type: 'number', value: 52 },
        { key: 'displacement', label: '이동값', type: 'number', value: 26 },
        { key: 'conversionColor', label: '전환선 색상', type: 'color', value: '#f97316' },
        { key: 'baseColor', label: '기준선 색상', type: 'color', value: '#38bdf8' },
        { key: 'spanAColor', label: '스팬A 색상', type: 'color', value: '#22c55e' },
        { key: 'spanBColor', label: '스팬B 색상', type: 'color', value: '#ef4444' },
        { key: 'laggingColor', label: '후행스팬 색상', type: 'color', value: '#a78bfa' },
    ],
    getScaleSeries(indicator, candles) {
        const conversionPeriod = getIndicatorNumber(indicator, 'conversion', 9);
        const basePeriod = getIndicatorNumber(indicator, 'base', 26);
        const spanBPeriod = getIndicatorNumber(indicator, 'spanB', 52);
        const data = calculateIchimoku(candles, conversionPeriod, basePeriod, spanBPeriod);
        return [data.conversion, data.base, data.spanA, data.spanB, data.lagging];
    },
    drawOverlay(indicator, context) {
        const { ctx, candles, padding, xForIndex, yForPrice } = context;
        const conversionPeriod = getIndicatorNumber(indicator, 'conversion', 9);
        const basePeriod = getIndicatorNumber(indicator, 'base', 26);
        const spanBPeriod = getIndicatorNumber(indicator, 'spanB', 52);
        const displacement = Math.round(getIndicatorNumber(indicator, 'displacement', 26));
        const conversionColor = getIndicatorColor(indicator, 'conversionColor', '#f97316');
        const baseColor = getIndicatorColor(indicator, 'baseColor', '#38bdf8');
        const spanAColor = getIndicatorColor(indicator, 'spanAColor', '#22c55e');
        const spanBColor = getIndicatorColor(indicator, 'spanBColor', '#ef4444');
        const laggingColor = getIndicatorColor(indicator, 'laggingColor', '#a78bfa');
        const data = calculateIchimoku(candles, conversionPeriod, basePeriod, spanBPeriod);

        const drawShiftedLine = (series, color, shift = 0, lineWidth = 1.2) => {
            ctx.save();
            ctx.strokeStyle = color;
            ctx.lineWidth = lineWidth;
            ctx.beginPath();
            let started = false;

            series.forEach((value, index) => {
                const shiftedIndex = index + shift;
                if (!Number.isFinite(value) || shiftedIndex < 0 || shiftedIndex >= candles.length) {
                    started = false;
                    return;
                }

                const x = xForIndex(shiftedIndex);
                const y = yForPrice(value);
                if (!started) {
                    ctx.moveTo(x, y);
                    started = true;
                } else {
                    ctx.lineTo(x, y);
                }
            });

            ctx.stroke();
            ctx.restore();
        };

        drawShiftedLine(data.conversion, conversionColor, 0, 1.2);
        drawShiftedLine(data.base, baseColor, 0, 1.2);
        drawShiftedLine(data.spanA, spanAColor, displacement, 1.1);
        drawShiftedLine(data.spanB, spanBColor, displacement, 1.1);
        drawShiftedLine(data.lagging, laggingColor, -displacement, 1);

        ctx.fillStyle = conversionColor;
        ctx.font = '11px Noto Sans KR, sans-serif';
        ctx.fillText(`Ichimoku ${conversionPeriod}/${basePeriod}/${spanBPeriod}`, padding.left + 4, padding.top + 46);
    },
};
