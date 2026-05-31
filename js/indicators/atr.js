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
    help: {
        title: 'ATR',
        summary: '가격 방향이 아니라 평균 변동폭을 보여주는 지표입니다.',
        parameters: [
            '기간: 변동폭 평균을 계산할 봉 개수입니다.',
        ],
        chart: 'ATR이 커지면 변동성이 커진 상태, 작아지면 변동성이 줄어든 상태로 참고합니다.',
        autoTrade: '현재 자동매매 엔진에서는 ATR을 주문 신호로 사용하지 않습니다. 차트 확인과 전략 저장용 지표로만 표시됩니다.',
        caution: 'ATR은 상승/하락 방향을 알려주지 않으므로 방향성 지표와 함께 봐야 합니다.',
    },
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
