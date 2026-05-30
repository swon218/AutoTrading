function normalizeIndicatorValues(key, values = {}) {
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
}

function getIndicatorNumber(indicator, key, fallback) {
    const value = Number(normalizeIndicatorValues(indicator.key, indicator.values)[key]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

function movingAverage(values, period, type = 'sma') {
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
}

function calculateRsi(closes, period) {
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
}

function calculateMacd(closes, fast, slow, signal) {
    const fastEma = movingAverage(closes, fast, 'ema');
    const slowEma = movingAverage(closes, slow, 'ema');
    const macd = closes.map((_, index) => {
        return fastEma[index] === null || slowEma[index] === null ? null : fastEma[index] - slowEma[index];
    });
    const signalLine = movingAverage(macd.map((value) => value ?? 0), signal, 'ema')
        .map((value, index) => (macd[index] === null ? null : value));

    return { macd, signalLine };
}

function calculateBollingerBands(closes, period, deviation) {
    const middle = movingAverage(closes, period, 'sma');
    const lower = Array(closes.length).fill(null);
    const safePeriod = Math.max(1, Math.round(period));

    for (let i = safePeriod - 1; i < closes.length; i += 1) {
        const slice = closes.slice(i - safePeriod + 1, i + 1);
        const average = middle[i];
        const variance = slice.reduce((sum, value) => sum + ((value - average) ** 2), 0) / safePeriod;
        lower[i] = average - Math.sqrt(variance) * deviation;
    }

    return { lower };
}

function calculateMfi(candles, period) {
    const result = Array(candles.length).fill(null);
    const moneyFlows = candles.map((candle, index) => {
        const typical = (candle.high + candle.low + candle.close) / 3;
        const previous = index > 0
            ? (candles[index - 1].high + candles[index - 1].low + candles[index - 1].close) / 3
            : typical;
        return {
            positive: typical > previous ? typical * (candle.volume || 0) : 0,
            negative: typical < previous ? typical * (candle.volume || 0) : 0,
        };
    });
    const safePeriod = Math.max(1, Math.round(period));

    for (let i = safePeriod; i < candles.length; i += 1) {
        const slice = moneyFlows.slice(i - safePeriod + 1, i + 1);
        const positive = slice.reduce((sum, item) => sum + item.positive, 0);
        const negative = slice.reduce((sum, item) => sum + item.negative, 0);
        result[i] = negative === 0 ? 100 : 100 - (100 / (1 + positive / negative));
    }

    return result;
}

function calculateStochastic(candles, period, smooth, signal) {
    const rawK = Array(candles.length).fill(null);
    const safePeriod = Math.max(1, Math.round(period));

    for (let i = safePeriod - 1; i < candles.length; i += 1) {
        const slice = candles.slice(i - safePeriod + 1, i + 1);
        const high = Math.max(...slice.map((candle) => candle.high));
        const low = Math.min(...slice.map((candle) => candle.low));
        rawK[i] = high === low ? 50 : ((candles[i].close - low) / (high - low)) * 100;
    }

    const k = movingAverage(rawK.map((value) => value ?? 0), smooth, 'sma')
        .map((value, index) => (rawK[index] === null ? null : value));
    const d = movingAverage(k.map((value) => value ?? 0), signal, 'sma')
        .map((value, index) => (k[index] === null ? null : value));

    return { k, d };
}

function latestPair(series) {
    const lastIndex = series.length - 1;
    return {
        previous: series[lastIndex - 1],
        latest: series[lastIndex],
    };
}

function crossedUp(previousA, latestA, previousB, latestB) {
    return Number.isFinite(previousA)
        && Number.isFinite(latestA)
        && Number.isFinite(previousB)
        && Number.isFinite(latestB)
        && previousA <= previousB
        && latestA > latestB;
}

function crossedDown(previous, latest, level) {
    return Number.isFinite(previous)
        && Number.isFinite(latest)
        && previous > level
        && latest <= level;
}

function evaluateIndicator(indicator, candles) {
    const closes = candles.map((candle) => candle.close);
    const values = normalizeIndicatorValues(indicator.key, indicator.values || {});

    if (indicator.key === 'rsi') {
        const series = calculateRsi(closes, getIndicatorNumber(indicator, 'period', 14));
        const { previous, latest } = latestPair(series);
        const lower = Number(values.lower ?? 30);
        return {
            supported: true,
            matched: crossedDown(previous, latest, lower),
            summary: `RSI ${Number.isFinite(latest) ? latest.toFixed(2) : '-'}/${lower}`,
        };
    }

    if (indicator.key === 'macd') {
        const { macd, signalLine } = calculateMacd(
            closes,
            getIndicatorNumber(indicator, 'fast', 12),
            getIndicatorNumber(indicator, 'slow', 26),
            getIndicatorNumber(indicator, 'signal', 9),
        );
        const macdPair = latestPair(macd);
        const signalPair = latestPair(signalLine);
        return {
            supported: true,
            matched: crossedUp(macdPair.previous, macdPair.latest, signalPair.previous, signalPair.latest),
            summary: `MACD ${Number.isFinite(macdPair.latest) ? macdPair.latest.toFixed(2) : '-'}`,
        };
    }

    if (indicator.key === 'ma') {
        const type = values.maType || 'sma';
        const short = movingAverage(closes, getIndicatorNumber(indicator, 'short', 5), type);
        const long = movingAverage(closes, getIndicatorNumber(indicator, 'long', 20), type);
        const shortPair = latestPair(short);
        const longPair = latestPair(long);
        return {
            supported: true,
            matched: crossedUp(shortPair.previous, shortPair.latest, longPair.previous, longPair.latest),
            summary: `MA ${Number.isFinite(shortPair.latest) ? shortPair.latest.toFixed(0) : '-'}`,
        };
    }

    if (indicator.key === 'bollinger') {
        const bands = calculateBollingerBands(
            closes,
            getIndicatorNumber(indicator, 'period', 20),
            getIndicatorNumber(indicator, 'deviation', 2),
        );
        const closePair = latestPair(closes);
        const lowerPair = latestPair(bands.lower);
        return {
            supported: true,
            matched: Number.isFinite(closePair.latest)
                && Number.isFinite(lowerPair.latest)
                && closePair.previous > lowerPair.previous
                && closePair.latest <= lowerPair.latest,
            summary: `Bollinger close ${closePair.latest}`,
        };
    }

    if (indicator.key === 'mfi') {
        const series = calculateMfi(candles, getIndicatorNumber(indicator, 'period', 14));
        const { previous, latest } = latestPair(series);
        const lower = Number(values.lower ?? 20);
        return {
            supported: true,
            matched: crossedDown(previous, latest, lower),
            summary: `MFI ${Number.isFinite(latest) ? latest.toFixed(2) : '-'}/${lower}`,
        };
    }

    if (indicator.key === 'stochastic') {
        const data = calculateStochastic(
            candles,
            getIndicatorNumber(indicator, 'period', 14),
            getIndicatorNumber(indicator, 'smooth', 3),
            getIndicatorNumber(indicator, 'signal', 3),
        );
        const kPair = latestPair(data.k);
        const dPair = latestPair(data.d);
        const lower = Number(values.lower ?? 20);
        return {
            supported: true,
            matched: crossedUp(kPair.previous, kPair.latest, dPair.previous, dPair.latest)
                && Number.isFinite(kPair.latest)
                && kPair.latest <= lower,
            summary: `Stochastic %K ${Number.isFinite(kPair.latest) ? kPair.latest.toFixed(2) : '-'}`,
        };
    }

    return {
        supported: false,
        matched: false,
        summary: `${indicator.key} is not supported by auto engine yet`,
    };
}

function evaluateStrategy(strategyConfig, candles) {
    const indicators = Array.isArray(strategyConfig?.indicators)
        ? strategyConfig.indicators
        : Array.isArray(strategyConfig) ? strategyConfig : [];
    const supportedResults = indicators
        .map((indicator) => evaluateIndicator(indicator, candles))
        .filter((result) => result.supported);

    if (!candles.length) {
        return { matched: false, reason: 'No candles', details: [] };
    }
    if (!supportedResults.length) {
        return { matched: false, reason: 'No supported indicators', details: [] };
    }

    const matched = supportedResults.every((result) => result.matched);
    return {
        matched,
        reason: matched ? 'Strategy signal matched' : 'Strategy signal not matched',
        details: supportedResults.map((result) => result.summary),
    };
}

module.exports = {
    evaluateStrategy,
};
