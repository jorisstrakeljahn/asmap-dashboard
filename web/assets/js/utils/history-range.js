// History range resolution. Range keys: "1y" / "3y" / "5y" /
// "max". Bounds evaluated against Date.now() at call time so a
// tab left open across midnight refreshes on next render.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const RANGE_DAYS = {
    "1y": 365,
    "3y": 365 * 3,
    "5y": 365 * 5,
};

export const DEFAULT_HISTORY_RANGE = "max";

function filterMapsByRange(maps, range) {
    if (!Array.isArray(maps)) return [];
    if (range === "max" || !RANGE_DAYS[range]) return maps;
    const cutoff = Date.now() - RANGE_DAYS[range] * MS_PER_DAY;
    return maps.filter((m) => new Date(m.released_at).getTime() >= cutoff);
}

// Returns the filtered slice plus the time domain charts should
// span. Bounded ranges pin to [now - N days, now] so a publishing
// pause shows as empty space; "max" pins left to the oldest build
// but still anchors right to "now" so freshness stays visible.
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
