import { getIndicatorColor, getIndicatorNumber, normalizeIndicatorValues } from './utils.js';

const calculateRsi = (closes, period) => {
    const result = Array(closes.length).fill(null);
    const safePeriod = Math.max(1, Math.round(period));
    let gain = 0;
    let loss = 0;

    for (let i = 1; i < closes.length; i += 1) {
        const change = closes[i] - closes[i - 1];
        const currentGain = Math.max(0, change);
        const currentLoss = Math.max(0, -change);

        if (i <= safePeriod) {
            gain += currentGain;
            loss += currentLoss;
            if (i === safePeriod) {
                gain /= safePeriod;
                loss /= safePeriod;
                result[i] = loss === 0 ? 100 : 100 - (100 / (1 + gain / loss));
            }
        } else {
            gain = ((gain * (safePeriod - 1)) + currentGain) / safePeriod;
            loss = ((loss * (safePeriod - 1)) + currentLoss) / safePeriod;
            result[i] = loss === 0 ? 100 : 100 - (100 / (1 + gain / loss));
        }
    }

    return result;
};

export default {
    key: 'rsi',
    name: 'RSI',
    aliases: ['rsi', '상대강도지수'],
    description: '과매수/과매도 구간을 판단합니다.',
    help: {
        title: 'RSI',
        summary: '최근 봉들의 상승폭과 하락폭을 비교해서 과매수/과매도 상태를 판단하는 지표입니다.',
        parameters: [
            '기간: RSI 계산에 사용할 봉 개수입니다. 15분봉에서 14라면 최근 14개 15분봉을 봅니다.',
            '하단값: 과매도 기준입니다. 보통 30을 사용합니다.',
            '상단값: 과매수 기준입니다. 보통 70을 사용합니다.',
        ],
        chart: 'RSI선이 하단값 근처로 내려가면 단기적으로 많이 밀린 상태, 상단값 근처로 올라가면 많이 오른 상태로 해석합니다.',
        autoTrade: '현재 자동매매에서는 RSI가 이전 봉에서 하단값보다 위에 있다가 최신 봉에서 하단값 이하로 내려오는 순간을 매수 신호로 봅니다.',
        caution: '강한 하락장에서는 RSI가 낮아도 추가 하락이 이어질 수 있어 다른 지표나 가격 범위 조건과 함께 보는 것이 좋습니다.',
    },
    panel: 'lower',
    fields: [
        { key: 'period', label: '기간', type: 'number', value: 14 },
        { key: 'lower', label: '하단값', type: 'number', value: 30 },
        { key: 'upper', label: '상단값', type: 'number', value: 70 },
        { key: 'lineColor', label: 'RSI선 색상', type: 'color', value: '#f59e0b' },
        { key: 'upperColor', label: '상단선 색상', type: 'color', value: '#f87171' },
        { key: 'lowerColor', label: '하단선 색상', type: 'color', value: '#60a5fa' },
    ],
    drawPanel(indicator, context) {
        const { ctx, closes, panel, drawSeriesLine, width, padding } = context;
        const values = normalizeIndicatorValues(indicator.key, indicator.values);
        const period = getIndicatorNumber(indicator, 'period', 14);
        const lower = Number(values.lower ?? 30);
        const upper = Number(values.upper ?? 70);
        const lineColor = getIndicatorColor(indicator, 'lineColor', '#f59e0b');
        const upperColor = getIndicatorColor(indicator, 'upperColor', '#f87171');
        const lowerColor = getIndicatorColor(indicator, 'lowerColor', '#60a5fa');
        const series = calculateRsi(closes, period);
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
        ctx.fillText(`RSI ${period}`, padding.left + 4, panel.top + 14);
    },
};
