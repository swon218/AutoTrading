// 웹에 보여줄 지표 목록
import rsi from './rsi.js';
import macd from './macd.js';
import bollinger from './bollinger.js';
import movingAverage from './movingAverage.js';
import mfi from './mfi.js';
import { normalizeIndicatorValues } from './utils.js';

export { normalizeIndicatorValues };

export const indicatorDefinitions = [
    rsi,
    macd,
    bollinger,
    movingAverage,
    mfi,
];

export const getIndicatorDefinition = (key) => {
    return indicatorDefinitions.find((definition) => definition.key === key);
};

