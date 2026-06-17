// Number, percent, and date formatting helpers shared across the
// dashboard. Centralised so locale, fraction-digit defaults, and
// signed-value conventions stay consistent between cards, charts,
// and tables.

const numberFormatter = new Intl.NumberFormat("en-US");
// Y-axis tick formatter for file sizes. Trailing zeros dropped
// (1.60 -> "1.6") so ticks stay narrow; minimum one fraction digit
// keeps round values as "2.0" rather than a bare "2".
const megabyteFormatter = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
});
// Build dates arrive as UTC "YYYY-MM-DD" strings. Pin the formatter
// to UTC so a viewer west of UTC does not see the previous day.
const dateFormatter = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
});

export function formatNumber(value) {
    return numberFormatter.format(value);
}

// Compact y-axis tick label: counts >= 1000 round to whole "k" units
// since literal counts ("412,539") are too wide for a chart gutter.
// Shared by every count-axis chart for a consistent tick vocabulary.
export function formatCompactCount(value) {
    return Math.abs(value) >= 1000
        ? `${Math.round(value / 1000)}k`
        : String(value);
}

// IPv4 and IPv6 carry incomparable address-space sizes, so coverage
// uses one of the two helpers below rather than a generic formatter.
//
// IPv4 totals stay below 4.3e9 (the full address space), so they fit
// a cell raw with thousands separators, labelled "IPv4 addresses".
//
// IPv6 totals routinely reach 10e33 (a single /32 covers 2^96), which
// overflows the cell and JS Number precision past 2^53. We quantise
// to /32 blocks — the exact granularity of Bitcoin Core GetGroup()'s
// IPv6 NetGroup bucket — so one block here equals one peer-diversity
// bucket there.
//
// BigInt is mandatory since the input regularly exceeds 2^53.
// Number(BigInt >> 96n) is safe: the shifted result (~1e6 blocks at
// most) stays well under the 2^53 ceiling.
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
    // The shift floors to whole /32 blocks, so an AS that moved only a
    // few /48s would read "0" while listed as an active mover; "<1"
    // keeps them consistent. A true zero still renders "0".
    if (blocks === 0 && big > 0n) return "<1";
    return numberFormatter.format(blocks);
}

// Single entry point keyed by address family so callers never branch
// on v4 vs v6 themselves. Returns just the digits so the caller can
// compose the unit suffix in its own locale.
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

// Bytes -> "1.86 MB" using decimal megabytes (1 MB = 1,000,000 bytes),
// matching how modern OSes report file sizes. Always two fraction
// digits so adjacent y-axis ticks share the same width.
export function formatMegabytes(bytes) {
    return `${megabyteFormatter.format(bytes / 1e6)} MB`;
}

// Glue a number to its adjacent word so a tight column never orphans
// the unit ("0\nunmapped") or its label ("IPv4\n7,024"). Only spaces
// directly next to a digit become non-breaking; every other space
// stays a valid wrap point, and comma separators are untouched so a
// count list still breaks between segments.
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
    // a date-only string, so truncate ``reference`` too. Otherwise the
    // result depends on the viewer's local time and can flip the
    // staleness headline by a day.
    const refUtcMidnight = Date.UTC(
        reference.getUTCFullYear(),
        reference.getUTCMonth(),
        reference.getUTCDate(),
    );
    const ms = refUtcMidnight - then.getTime();
    return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}
