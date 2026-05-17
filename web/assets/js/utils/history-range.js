// Resolve a history-range key to the slice of maps that fits in
// the window plus the raw time domain the x axis should span.
// Centralised so the charts stay window-agnostic: each chart
// consumes the slice and the bounds and the picker swaps both
// without touching chart code.
//
// Range keys mirror common analytics conventions:
//   "1y" / "3y" / "5y" - last N years from today
//   "max"              - every build in the array
//
// All bounds are evaluated against Date.now() at call time so a
// tab left open across midnight picks the freshest window on the
// next render. The maps array is assumed sorted oldest-first
// (metrics.json guarantees this), so the filter preserves order.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const RANGE_DAYS = {
    "1y": 365,
    "3y": 365 * 3,
    "5y": 365 * 5,
};

export const DEFAULT_HISTORY_RANGE = "max";

// Internal: filter to builds inside the picker's range. Kept
// private so callers always go through ``resolveHistoryRange``
// and receive the matching domain bounds alongside the slice,
// never one without the other.
function filterMapsByRange(maps, range) {
    if (!Array.isArray(maps)) return [];
    if (range === "max" || !RANGE_DAYS[range]) return maps;
    const cutoff = Date.now() - RANGE_DAYS[range] * MS_PER_DAY;
    return maps.filter((m) => new Date(m.released_at).getTime() >= cutoff);
}

// Resolve a range key to its filtered slice plus the time domain
// charts should span. Splitting "what data fits" from "what
// calendar window the picker promised" lets bounded ranges
// honour their span even when no build sits at the edge:
//
//   - Bounded ranges ("1y" / "3y" / "5y") pin the domain to
//     [now - N days, now]. A publishing pause at either edge of
//     the range shows as empty space rather than the chart
//     silently snapping in to the first or last available build.
//     The right edge at "now" also makes data staleness visible:
//     if the latest build is two months old, there are two
//     months of empty space on the right rather than a chart
//     that always looks current.
//
//   - "max" has no calendar promise, so left collapses to the
//     oldest build and right still sits at "now" so freshness
//     stays visible across every picker option.
//
// Charts apply their own start-snap (e.g. month boundary), so
// we hand back raw milliseconds and the snapping policy stays
// in one place.
export function resolveHistoryRange(maps, range = DEFAULT_HISTORY_RANGE) {
    const filtered = filterMapsByRange(maps, range);
    const now = Date.now();
    if (filtered.length === 0) {
        return { maps: filtered, domainStart: null, domainEnd: null };
    }
    const firstMs = new Date(filtered[0].released_at).getTime();
    const lastMs = new Date(filtered[filtered.length - 1].released_at).getTime();
    if (range === "max" || !RANGE_DAYS[range]) {
        return {
            maps: filtered,
            domainStart: firstMs,
            domainEnd: Math.max(now, lastMs),
        };
    }
    return {
        maps: filtered,
        domainStart: now - RANGE_DAYS[range] * MS_PER_DAY,
        domainEnd: now,
    };
}
