// Number, percent, and date formatting helpers shared across the
// dashboard. Centralised so locale, fraction-digit defaults, and
// signed-value conventions stay consistent between cards, charts,
// and tables.

const numberFormatter = new Intl.NumberFormat("en-US");
// Y-axis tick formatter for file sizes. Trailing zeros are dropped
// (1.60 -> "1.6") so adjacent ticks stay narrow, freeing the left
// gutter for the rotated y-axis title without overlap. The minimum
// of one fraction digit keeps round values readable as "2.0" rather
// than the bare "2", which would look like a different metric.
const megabyteFormatter = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
});
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

// Bytes -> "1.86 MB" using decimal megabytes (1 MB = 1,000,000 bytes)
// because on-disk file sizes on modern OSes are reported the same way
// and the unit is unambiguous against the tooltip's raw byte figure.
// Always two fraction digits so adjacent ticks line up visually on the
// y axis (e.g. "1.86 MB" / "1.90 MB" share the same width).
export function formatMegabytes(bytes) {
    return `${megabyteFormatter.format(bytes / 1e6)} MB`;
}

export function formatDate(isoDate) {
    return dateFormatter.format(new Date(isoDate));
}

export function daysBetween(isoDate, reference = new Date()) {
    const then = new Date(isoDate);
    const ms = reference.getTime() - then.getTime();
    return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

export function shortDate(isoDate) {
    const d = new Date(isoDate);
    const month = d.toLocaleString("en-US", { month: "short" });
    const year = String(d.getFullYear()).slice(-2);
    return `${month} ${year}`;
}
