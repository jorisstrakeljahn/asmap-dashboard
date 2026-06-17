// History range resolution. Keys "1y"/"3y"/"5y"/"max"; bounds use
// Date.now() at call time so a tab left open across midnight
// refreshes on next render. Single source of truth for the range
// picker shared by Maps (History) and Network (Trends).
// rangeBounds() takes plain ms timestamps; resolveHistoryRange()
// wraps it for the maps array.

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

const RANGE_DAYS = {
    "1y": 365,
    "3y": 365 * 3,
    "5y": 365 * 5,
};

// Bloomberg / TradingView convention for instant recognition.
export const HISTORY_RANGE_VALUES = ["1y", "3y", "5y", "max"];

export const DEFAULT_HISTORY_RANGE = "max";

// Resolve the cutoff (drop older points) plus the x-axis domain,
// from plain ms timestamps. Bounded ranges pin to [now - N days,
// now] so a publishing pause shows as empty space; "max" spans the
// full extent but still anchors right to "now" for freshness.
export function rangeBounds(range, timestamps = []) {
    const now = Date.now();
    if (range === "max" || !RANGE_DAYS[range]) {
        const first = timestamps.length ? Math.min(...timestamps) : now;
        const last = timestamps.length ? Math.max(...timestamps) : now;
        return {
            cutoff: -Infinity,
            domainStart: first,
            domainEnd: Math.max(now, last),
        };
    }
    const cutoff = now - RANGE_DAYS[range] * MS_PER_DAY;
    return { cutoff, domainStart: cutoff, domainEnd: now };
}

// Filtered maps slice plus the time domain charts span (see
// rangeBounds). An empty slice yields null bounds so each chart's
// empty state can take over.
export function resolveHistoryRange(maps, range = DEFAULT_HISTORY_RANGE) {
    const list = Array.isArray(maps) ? maps : [];
    const timestamps = list.map((m) => new Date(m.released_at).getTime());
    const { cutoff, domainStart, domainEnd } = rangeBounds(range, timestamps);
    const filtered =
        cutoff === -Infinity
            ? list
            : list.filter((m) => new Date(m.released_at).getTime() >= cutoff);
    if (filtered.length === 0) {
        return { maps: filtered, domainStart: null, domainEnd: null };
    }
    return { maps: filtered, domainStart, domainEnd };
}
