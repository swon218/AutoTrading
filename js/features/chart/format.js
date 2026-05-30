export function formatNumber(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
        return '-';
    }
    return Number(value).toLocaleString('ko-KR');
}
