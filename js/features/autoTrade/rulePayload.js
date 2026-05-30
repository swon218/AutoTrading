export function buildAutoTradeRulePayload({
    currentStockCode,
    stockName,
    strategyId,
    maxBuyPrice,
    minBuyPrice,
    orderQuantity,
    priceRangeAgreed,
    signalGuardAgreed,
}) {
    return {
        stockCode: currentStockCode,
        stockName,
        strategyId,
        maxBuyPrice,
        minBuyPrice,
        orderQuantity,
        priceRangeAgreed,
        cashGuardAgreed: true,
        signalGuardAgreed,
        telegramAlertEnabled: true,
        autoOrderEnabled: true,
        isEnabled: true,
    };
}
