const numberFormatter = new Intl.NumberFormat("en-US");
const dateFormatter = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
});

export function formatNumber(value) {
    return numberFormatter.format(value);
}

export function formatPercent(ratio, fractionDigits = 1) {
    return `${(ratio * 100).toFixed(fractionDigits)}%`;
}

export function formatSignedPercent(ratio, fractionDigits = 1) {
    const sign = ratio > 0 ? "+" : "";
    return `${sign}${(ratio * 100).toFixed(fractionDigits)}%`;
}

export function formatSignedNumber(value) {
    const sign = value > 0 ? "+" : "";
    return `${sign}${numberFormatter.format(value)}`;
}

export function formatDate(isoDate) {
    return dateFormatter.format(new Date(isoDate));
}

export function daysBetween(isoDate, reference = new Date()) {
    const then = new Date(isoDate);
    const ms = reference.getTime() - then.getTime();
    return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}
