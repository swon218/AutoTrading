//키움 숫자/날짜 변환 공통 함수

function numberFromKiwoom(value) {
    if (value === undefined || value === null || value === '') return null;
    const normalized = String(value).replace(/,/g, '');
    const number = Number(normalized);
    return Number.isFinite(number) ? number : null;
}

function signedNumber(value) {
    const number = numberFromKiwoom(value);
    return number === null ? null : number;
}

function absoluteNumber(value) {
    const number = numberFromKiwoom(value);
    return number === null ? null : Math.abs(number);
}

function todayYmd() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
}

function kiwoomDateToTime(value) {
    const text = String(value || '');
    if (/^\d{14}$/.test(text)) {
        const year = text.slice(0, 4);
        const month = text.slice(4, 6);
        const day = text.slice(6, 8);
        const hour = text.slice(8, 10);
        const minute = text.slice(10, 12);
        const second = text.slice(12, 14);
        return `${year}-${month}-${day}T${hour}:${minute}:${second}+09:00`;
    }

    if (/^\d{8}$/.test(text)) {
        const year = text.slice(0, 4);
        const month = text.slice(4, 6);
        const day = text.slice(6, 8);
        return `${year}-${month}-${day}`;
    }

    return text;
}

module.exports = {
    absoluteNumber,
    kiwoomDateToTime,
    signedNumber,
    todayYmd,
};
