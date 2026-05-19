//SMA/EMA 계산, 설정값 보정의 공통 함수 파일
export const normalizeIndicatorValues = (key, values = {}) => {
    const nextValues = { ...values };

    if ((key === 'rsi' || key === 'mfi') && nextValues.lower === undefined) {
        if (nextValues.min !== undefined && Number(nextValues.min) > 0) {
            nextValues.lower = nextValues.min;
        } else if (nextValues.max !== undefined && Number(nextValues.max) <= 40) {
            nextValues.lower = nextValues.max;
        }
    }

    if ((key === 'rsi' || key === 'mfi') && nextValues.upper === undefined) {
        if (nextValues.max !== undefined && Number(nextValues.max) > 40) {
            nextValues.upper = nextValues.max;
        } else {
            nextValues.upper = key === 'rsi' ? 70 : 80;
        }
    }

    return nextValues;
};

export const getIndicatorNumber = (indicator, key, fallback) => {
    const value = Number(normalizeIndicatorValues(indicator.key, indicator.values)[key]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
};

export const getIndicatorColor = (indicator, key, fallback) => {
    const value = normalizeIndicatorValues(indicator.key, indicator.values)[key];
    return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : fallback;
};

export const movingAverage = (values, period, type = 'sma') => {
    const length = values.length;
    const result = Array(length).fill(null);
    const safePeriod = Math.max(1, Math.round(period));

    if (type === 'ema') {
        const multiplier = 2 / (safePeriod + 1);
        let ema = null;

        for (let i = 0; i < length; i += 1) {
            const value = values[i];
            if (!Number.isFinite(value)) continue;
            ema = ema === null ? value : (value - ema) * multiplier + ema;
            if (i >= safePeriod - 1) result[i] = ema;
        }

        return result;
    }

    let sum = 0;
    for (let i = 0; i < length; i += 1) {
        sum += values[i];
        if (i >= safePeriod) sum -= values[i - safePeriod];
        if (i >= safePeriod - 1) result[i] = sum / safePeriod;
    }

    return result;
};
