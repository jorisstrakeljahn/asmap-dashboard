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
// Build dates arrive as UTC "YYYY-MM-DD" strings (derived from the
// Unix timestamps in the build filenames). Pin the formatter to UTC
// so a viewer west of UTC does not see the previous calendar day.
const dateFormatter = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
});

export function formatNumber(value) {
    return numberFormatter.format(value);
}

// Compact y-axis tick label: literal counts ("412,539") are wider
// than a chart gutter can afford, so anything from a thousand up is
// rounded to whole "k" units. Shared by every count-axis chart so
// the tick vocabulary stays identical across them.
export function formatCompactCount(value) {
    return Math.abs(value) >= 1000
        ? `${Math.round(value / 1000)}k`
        : String(value);
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
    // The shift floors to whole /32 blocks. An AS that moved only a
    // few /48s would read "0 blocks" while the table lists it as an
    // active mover — "<1" keeps the two statements consistent.
    // A true zero (nothing moved / no footprint) still renders "0".
    if (blocks === 0 && big > 0n) return "<1";
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

// Keep a number glued to the word touching it so a tight column never
// orphans the unit on its own line ("0\nunmapped") or strands the number
// from its label ("IPv4\n7,024"). Only spaces directly adjacent to a
// digit become non-breaking; every other space stays a valid wrap point,
// so a long line like "between 4.2% at 252 days and …" still wraps — it
// just never splits "252 days" or "4.2%" mid-pair. Comma separators are
// untouched, so a count list still breaks between its segments.
export function glueUnits(text) {
    return String(text)
        .replace(/(\d)\u0020/g, "$1\u00A0")
        .replace(/\u0020(\d)/g, "\u00A0$1");
}

export function formatDate(isoDate) {
    return dateFormatter.format(new Date(isoDate));
}

export function daysBetween(isoDate, reference = new Date()) {
    const then = new Date(isoDate);
    // Compare on the UTC day grid: ``then`` is already UTC midnight for
    // a date-only string, so truncate ``reference`` to UTC midnight too.
    // Without this the result depends on the viewer's local time of day
    // and timezone, which can flip the staleness headline by a day.
    const refUtcMidnight = Date.UTC(
        reference.getUTCFullYear(),
        reference.getUTCMonth(),
        reference.getUTCDate(),
    );
    const ms = refUtcMidnight - then.getTime();
    return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}
