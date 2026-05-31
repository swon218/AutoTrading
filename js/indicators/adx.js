import { getIndicatorColor, getIndicatorNumber, movingAverage } from './utils.js';

const calculateDmi = (candles, period) => {
    const plusDm = Array(candles.length).fill(0);
    const minusDm = Array(candles.length).fill(0);
    const trueRange = Array(candles.length).fill(0);

    for (let index = 1; index < candles.length; index += 1) {
        const current = candles[index];
        const previous = candles[index - 1];
        const upMove = current.high - previous.high;
        const downMove = previous.low - current.low;

        plusDm[index] = upMove > downMove && upMove > 0 ? upMove : 0;
        minusDm[index] = downMove > upMove && downMove > 0 ? downMove : 0;
        trueRange[index] = Math.max(
            current.high - current.low,
            Math.abs(current.high - previous.close),
            Math.abs(current.low - previous.close),
        );
    }

    const smoothedPlusDm = movingAverage(plusDm, period, 'sma');
    const smoothedMinusDm = movingAverage(minusDm, period, 'sma');
    const smoothedTrueRange = movingAverage(trueRange, period, 'sma');
    const plusDi = candles.map((_, index) => {
        return smoothedTrueRange[index] ? (smoothedPlusDm[index] / smoothedTrueRange[index]) * 100 : null;
    });
    const minusDi = candles.map((_, index) => {
        return smoothedTrueRange[index] ? (smoothedMinusDm[index] / smoothedTrueRange[index]) * 100 : null;
    });
    const dx = candles.map((_, index) => {
        const plus = plusDi[index];
        const minus = minusDi[index];
        if (!Number.isFinite(plus) || !Number.isFinite(minus) || plus + minus === 0) return null;
        return (Math.abs(plus - minus) / (plus + minus)) * 100;
    });
    const adx = movingAverage(dx.map((value) => value ?? 0), period, 'sma')
        .map((value, index) => (dx[index] === null ? null : value));

    return { adx, plusDi, minusDi };
};

export default {
    key: 'adx',
    name: 'ADX/DMI',
    aliases: ['adx', 'dmi', 'adx dmi', '방향성지표', '추세강도'],
    description: 'ADX로 추세 강도, +DI/-DI로 상승/하락 방향성을 표시합니다.',
    help: {
        title: 'ADX/DMI',
        summary: 'ADX는 추세의 강도를, +DI와 -DI는 상승/하락 방향성을 보여주는 지표입니다.',
        parameters: [
            '기간: 방향성과 추세 강도를 계산할 봉 개수입니다.',
            '기준값: 추세가 의미 있게 강한지 판단하는 기준선입니다. 보통 25를 참고합니다.',
        ],
        chart: 'ADX가 기준값 위로 올라가면 추세가 강해지는 상태, +DI가 -DI 위에 있으면 상승 방향성을 참고합니다.',
        autoTrade: '현재 자동매매 엔진에서는 ADX/DMI를 주문 신호로 사용하지 않습니다. 차트 확인과 전략 저장용 지표로만 표시됩니다.',
        caution: 'ADX는 추세 강도만 보여주므로 방향은 +DI/-DI를 함께 확인해야 합니다.',
    },
    panel: 'lower',
    fields: [
        { key: 'period', label: '기간', type: 'number', value: 14 },
        { key: 'reference', label: '기준값', type: 'number', value: 25 },
        { key: 'adxColor', label: 'ADX 색상', type: 'color', value: '#facc15' },
        { key: 'plusColor', label: '+DI 색상', type: 'color', value: '#ef4444' },
        { key: 'minusColor', label: '-DI 색상', type: 'color', value: '#3b82f6' },
        { key: 'referenceColor', label: '기준선 색상', type: 'color', value: '#94a3b8' },
    ],
    drawPanel(indicator, context) {
        const { ctx, candles, panel, drawSeriesLine, width, padding } = context;
        const period = getIndicatorNumber(indicator, 'period', 14);
        const reference = getIndicatorNumber(indicator, 'reference', 25);
        const adxColor = getIndicatorColor(indicator, 'adxColor', '#facc15');
        const plusColor = getIndicatorColor(indicator, 'plusColor', '#ef4444');
        const minusColor = getIndicatorColor(indicator, 'minusColor', '#3b82f6');
        const referenceColor = getIndicatorColor(indicator, 'referenceColor', '#94a3b8');
        const { adx, plusDi, minusDi } = calculateDmi(candles, period);
        const yForValue = (value) => panel.bottom - (Math.max(0, Math.min(100, value)) / 100) * panel.height;
        const referenceY = yForValue(reference);

        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = referenceColor;
        ctx.beginPath();
        ctx.moveTo(padding.left, referenceY);
        ctx.lineTo(width - padding.right, referenceY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#cbd5e1';
        ctx.fillText(String(reference), width - padding.right + 8, referenceY + 4);

        drawSeriesLine(adx, adxColor, 1.5, yForValue);
        drawSeriesLine(plusDi, plusColor, 1.2, yForValue);
        drawSeriesLine(minusDi, minusColor, 1.2, yForValue);
        ctx.fillStyle = adxColor;
        ctx.fillText(`ADX/DMI ${period}`, padding.left + 4, panel.top + 14);
    },
};
