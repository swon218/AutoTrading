import { getIndicatorColor, getIndicatorNumber } from './utils.js';

const calculateWilliamsR = (candles, period) => {
    const safePeriod = Math.max(1, Math.round(period));
    const result = Array(candles.length).fill(null);

    for (let index = safePeriod - 1; index < candles.length; index += 1) {
        const slice = candles.slice(index - safePeriod + 1, index + 1);
        const high = Math.max(...slice.map((candle) => candle.high));
        const low = Math.min(...slice.map((candle) => candle.low));
        result[index] = high === low ? -50 : ((high - candles[index].close) / (high - low)) * -100;
    }

    return result;
};

export default {
    key: 'williamsR',
    name: 'Williams %R',
    aliases: ['williams', 'williams %r', 'williamsr', '윌리엄스', '윌리엄스r'],
    description: '최근 고가/저가 범위 안에서 종가 위치를 -100~0 범위로 표시합니다.',
    help: {
        title: 'Williams %R',
        summary: '최근 고가/저가 범위에서 현재 종가가 어느 위치에 있는지 -100부터 0 사이로 표시하는 지표입니다.',
        parameters: [
            '기간: 최근 고가/저가 범위를 계산할 봉 개수입니다.',
            '하단값: 과매도 기준입니다. 보통 -80 근처를 사용합니다.',
            '상단값: 과매수 기준입니다. 보통 -20 근처를 사용합니다.',
        ],
        chart: '값이 -80 아래에 가까우면 과매도, -20 위에 가까우면 과매수 구간으로 참고합니다.',
        autoTrade: '현재 자동매매 엔진에서는 Williams %R을 주문 신호로 사용하지 않습니다. 차트 확인과 전략 저장용 지표로만 표시됩니다.',
        caution: '과매도/과매수 구간에 오래 머무를 수 있어 단독 매매 기준으로 쓰기에는 위험할 수 있습니다.',
    },
    panel: 'lower',
    fields: [
        { key: 'period', label: '기간', type: 'number', value: 14 },
        { key: 'lower', label: '하단값', type: 'number', value: -80 },
        { key: 'upper', label: '상단값', type: 'number', value: -20 },
        { key: 'lineColor', label: 'Williams %R 색상', type: 'color', value: '#a78bfa' },
        { key: 'upperColor', label: '상단선 색상', type: 'color', value: '#f87171' },
        { key: 'lowerColor', label: '하단선 색상', type: 'color', value: '#60a5fa' },
    ],
    drawPanel(indicator, context) {
        const { ctx, candles, panel, drawSeriesLine, width, padding } = context;
        const period = getIndicatorNumber(indicator, 'period', 14);
        const upper = Number(indicator.values.upper ?? -20);
        const lower = Number(indicator.values.lower ?? -80);
        const lineColor = getIndicatorColor(indicator, 'lineColor', '#a78bfa');
        const upperColor = getIndicatorColor(indicator, 'upperColor', '#f87171');
        const lowerColor = getIndicatorColor(indicator, 'lowerColor', '#60a5fa');
        const series = calculateWilliamsR(candles, period);
        const yForValue = (value) => panel.bottom - ((value + 100) / 100) * panel.height;

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

        drawSeriesLine(series, lineColor, 1.5, yForValue);
        ctx.fillStyle = lineColor;
        ctx.fillText(`Williams %R ${period}`, padding.left + 4, panel.top + 14);
    },
};
