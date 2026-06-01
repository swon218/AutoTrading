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
    help: {
        title: 'OBV',
        summary: '가격이 오른 봉의 거래량은 더하고 내린 봉의 거래량은 빼서 누적 거래량 흐름을 보여주는 지표입니다.',
        parameters: [
            '평균 기간: OBV 흐름을 부드럽게 비교하기 위한 평균선 기간입니다.',
        ],
        chart: '가격보다 OBV가 먼저 강해지면 매수세 유입, 가격은 오르는데 OBV가 약하면 상승 힘 약화를 참고합니다.',
        autoTrade: '현재 자동매매 엔진에서는 OBV를 주문 신호로 사용하지 않습니다. 차트 확인과 전략 저장용 지표로만 표시됩니다.',
        caution: '거래량 급증일이 있으면 누적값이 크게 치우칠 수 있습니다.',
    },
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
