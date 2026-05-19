// 웹에 보여줄 지표 목록
import rsi from './rsi.js';
import macd from './macd.js';
import bollinger from './bollinger.js';
import movingAverage from './movingAverage.js';
import mfi from './mfi.js';
import stochastic from './stochastic.js';
import cci from './cci.js';
import williamsR from './williamsR.js';
import obv from './obv.js';
import atr from './atr.js';
import adx from './adx.js';
import ichimoku from './ichimoku.js';
import { normalizeIndicatorValues } from './utils.js';

export { normalizeIndicatorValues };

export const indicatorDefinitions = [
    rsi,
    macd,
    bollinger,
    movingAverage,
    mfi,
    stochastic,
    cci,
    williamsR,
    obv,
    atr,
    adx,
    ichimoku,
];

export const getIndicatorDefinition = (key) => {
    return indicatorDefinitions.find((definition) => definition.key === key);
};
