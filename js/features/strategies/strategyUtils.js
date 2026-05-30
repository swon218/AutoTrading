export function cloneIndicatorFromDefinition(definition) {
    return {
        id: `${definition.key}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        key: definition.key,
        values: Object.fromEntries(definition.fields.map((field) => [field.key, field.value])),
    };
}

export function dedupeIndicatorsByKey(indicators = []) {
    const seenKeys = new Set();
    return indicators.filter((indicator) => {
        if (!indicator?.key || seenKeys.has(indicator.key)) return false;
        seenKeys.add(indicator.key);
        return true;
    });
}

export function normalizeStrategyName(value) {
    return String(value || '').replace(/\s+/g, '').toLowerCase();
}
