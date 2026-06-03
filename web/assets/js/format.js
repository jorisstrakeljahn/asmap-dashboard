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

// IPv4 and IPv6 carry incomparable address-space sizes, so every
// coverage number on the dashboard is formatted through one of
// the two helpers below rather than a single generic formatter.
//
// IPv4 totals across published builds stay below 4.3e9 (the full
// IPv4 address space). Written out with thousands separators they
// fit in a tooltip or table cell, so we render them raw and label
// the unit as "IPv4 addresses".
//
// IPv6 totals routinely reach 10e33 because a single /32 covers
// 2^96 addresses. Raw decimals overflow the cell and JS Number
// loses precision past 2^53. We therefore quantise IPv6 coverage
// to /32 blocks, which is the exact granularity Bitcoin Core
// GetGroup() uses for the IPv6 NetGroup bucket. One /32 in the
// dashboard is one peer diversity bucket in Bitcoin Core, so a
// number a reader sees here can be reasoned about directly.
//
// BigInt is mandatory on the IPv6 path because the input value
// regularly exceeds 2^53. Number(BigInt >> 96n) is safe because
// the result of the shift fits in a Number long before reaching
// the 2^53 ceiling (the largest /32 count plausibly emitted by
// the pipeline is on the order of 1e6 blocks).
export const FAMILY_IPV4 = "ipv4";
export const FAMILY_IPV6 = "ipv6";

const IPV6_NETGROUP_BITS = 96n;

export function formatIpv4Addresses(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return "—";
    return numberFormatter.format(numeric);
}

export function formatIpv6Blocks(value) {
    if (value == null) return "—";
    let big;
    try {
        big = BigInt(value);
    } catch {
        return "—";
    }
    const blocks = Number(big >> IPV6_NETGROUP_BITS);
    return numberFormatter.format(blocks);
}

// Single entry point keyed by address family so callers (drift
// tooltip, top movers cell, match banner) never have to branch on
// "is this v4 or v6" themselves. Returns just the digits so the
// caller can compose the unit suffix in the locale it owns; the
// helpers below cover the two cases where the caller wants the
// digits and the unit baked in.
export function formatCoverage(value, family) {
    if (family === FAMILY_IPV6) return formatIpv6Blocks(value);
    return formatIpv4Addresses(value);
}

export function familyUnitLabel(family) {
    return family === FAMILY_IPV6 ? "IPv6 /32 blocks" : "IPv4 addresses";
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
