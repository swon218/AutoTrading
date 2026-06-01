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
    help: {
        title: '스토캐스틱',
        summary: '최근 고가와 저가 범위 안에서 현재 종가가 어디에 있는지 %K와 %D로 보여주는 지표입니다.',
        parameters: [
            '%K 기간: 최근 고가/저가 범위를 계산할 봉 개수입니다.',
            '%K 평활: %K선을 부드럽게 만드는 평균 기간입니다.',
            '%D 기간: %K의 신호선 역할을 하는 평균 기간입니다.',
            '하단값/상단값: 과매도/과매수 기준입니다.',
        ],
        chart: '%K가 %D를 상향 돌파하면 단기 반등 신호, 하향 돌파하면 약화 신호로 참고합니다.',
        autoTrade: '현재 자동매매에서는 %K가 %D를 아래에서 위로 돌파하고, 최신 %K가 하단값 이하일 때 매수 신호로 봅니다.',
        caution: '짧은 기간에서는 매우 민감해서 신호가 자주 발생할 수 있습니다.',
    },
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
