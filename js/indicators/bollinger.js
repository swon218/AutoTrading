import { getIndicatorNumber, movingAverage } from './utils.js';

const calculateBollingerBands = (closes, period, deviation) => {
    const middle = movingAverage(closes, period, 'sma');
    const upper = Array(closes.length).fill(null);
    const lower = Array(closes.length).fill(null);
    const safePeriod = Math.max(1, Math.round(period));

    for (let i = safePeriod - 1; i < closes.length; i += 1) {
        const slice = closes.slice(i - safePeriod + 1, i + 1);
        const average = middle[i];
        const variance = slice.reduce((sum, value) => sum + ((value - average) ** 2), 0) / safePeriod;
        const bandWidth = Math.sqrt(variance) * deviation;
        upper[i] = average + bandWidth;
        lower[i] = average - bandWidth;
    }

    return { upper, middle, lower };
};

export default {
    key: 'bollinger',
    name: '볼린저밴드',
    aliases: ['볼린저', '볼린저밴드', 'bollinger', 'bbands'],
    description: '종가 기준 중심선과 상하단 밴드를 표시합니다.',
    panel: 'overlay',
    fields: [
        { key: 'period', label: '기간', type: 'number', value: 20 },
        { key: 'deviation', label: '표준편차', type: 'number', value: 2 },
    ],
    getScaleSeries(indicator, candles) {
        const closes = candles.map((candle) => candle.close);
        const bands = calculateBollingerBands(
            closes,
            getIndicatorNumber(indicator, 'period', 20),
            getIndicatorNumber(indicator, 'deviation', 2),
        );
        return [bands.upper, bands.lower];
    },
    drawOverlay(indicator, context) {
        const { ctx, closes, drawSeriesLine, padding } = context;
        const period = getIndicatorNumber(indicator, 'period', 20);
        const deviation = getIndicatorNumber(indicator, 'deviation', 2);
        const bands = calculateBollingerBands(closes, period, deviation);

        drawSeriesLine(bands.upper, 'rgba(168, 85, 247, 0.95)', 1.2);
        drawSeriesLine(bands.middle, 'rgba(203, 213, 225, 0.65)', 1.1);
        drawSeriesLine(bands.lower, 'rgba(168, 85, 247, 0.95)', 1.2);

        ctx.fillStyle = '#c4b5fd';
        ctx.font = '11px Noto Sans KR, sans-serif';
        ctx.fillText(`BB ${period}/${deviation}`, padding.left + 4, padding.top + 30);
    },
};

