// Timeline helpers shared by the Network trend charts: collecting the
// full timestamp extent the "max" range anchors to, clamping a
// timeline to a range cutoff, and bucketing points by calendar day so
// two crawlers' same-day snapshots share one slot (and one hover).

import { MS_PER_DAY } from "../../utils/history-range.js";
import { toMs } from "./series-data.js";

// Every timestamp the trends can plot (snapshot times + decay build
// times), used to anchor the "max" domain to the real data extent.
export function collectTimestamps(network, sources) {
    const out = [];
    for (const source of sources) {
        const data = network.sources[source];
        for (const sn of data.snapshots) out.push(toMs(sn.timestamp));
        for (const p of data.decay.points) out.push(toMs(p.build_timestamp));
    }
    return out;
}

// Drop the slots before ``cutoff`` while keeping valueAt addressable
// by remapping each surviving slot back to its original index.
export function clampTimeline(timeline, cutoff) {
    if (cutoff === -Infinity) return timeline;
    const keep = [];
    for (let i = 0; i < timeline.timestamps.length; i++) {
        if (timeline.timestamps[i] >= cutoff) keep.push(i);
    }
    return {
        timestamps: keep.map((i) => timeline.timestamps[i]),
        valueAt: (source, slot) => timeline.valueAt(source, keep[slot]),
    };
}

// Upper-bound twin of clampTimeline: drop the slots ABOVE ``ceiling``.
// The decay age axis is windowed this way — a calendar range (1Y/3Y/5Y)
// maps to a maximum map age of the same width because age = reference −
// build date, so "the last year" -> "ages up to ~365 days". Anchored at
// the reference build, not at "now" (see trend-charts.js), so the two
// share a width but not necessarily the exact build set.
export function clampTimelineMax(timeline, ceiling) {
    if (ceiling === Infinity) return timeline;
    const keep = [];
    for (let i = 0; i < timeline.timestamps.length; i++) {
        if (timeline.timestamps[i] <= ceiling) keep.push(i);
    }
    return {
        timestamps: keep.map((i) => timeline.timestamps[i]),
        valueAt: (source, slot) => timeline.valueAt(source, keep[slot]),
    };
}

// Like buildUnionTimeline, but keys slots by calendar day so points
// from different crawlers that fall on the same day share one slot (and
// therefore one hover) instead of landing on adjacent timestamps. The
// representative timestamp for a day is the earliest point in it, so the
// x-position and tooltip date stay real rather than snapping to midnight.
export function dayUnionTimeline(entries) {
    const byDay = new Map();
    for (const entry of entries) {
        for (const point of entry.points) {
            const day = Math.floor(point.ts / MS_PER_DAY);
            let bucket = byDay.get(day);
            if (!bucket) {
                bucket = { ts: point.ts, values: new Map() };
                byDay.set(day, bucket);
            }
            if (point.ts < bucket.ts) bucket.ts = point.ts;
            if (point.value != null) bucket.values.set(entry.source, point.value);
        }
    }
    const days = [...byDay.keys()].sort((a, b) => a - b);
    return {
        timestamps: days.map((d) => byDay.get(d).ts),
        valueAt: (source, slot) => {
            const value = byDay.get(days[slot])?.values.get(source);
            return value == null ? null : value;
        },
    };
}
