// Timeline helpers shared by the Network trend charts: collecting the full
// timestamp extent the "max" range anchors to, clamping a timeline to a range
// cutoff, and picking which crawl samples to draw.
//
// Display rules (range picker → grain):
//   1Y  → weekly: one bar/point per week so the series keeps moving between
//         ASmap builds (~3–4 weekly samples in a typical build gap).
//   3Y / 5Y / Max → monthly: every ASmap build stays a point; months without
//         a build still get one crawl sample so long quiet stretches (no new
//         map) still show network change.
// Fillers use the period's earliest crawl for even spacing. A period that
// contains a build change uses that crawl instead. Daily samples stay in the
// payload.

import { MS_PER_DAY } from "../../utils/history-range.js";
import { toMs } from "./series-data.js";

export const CHART_GRANULARITIES = ["week", "month"];

export function chartGranularity(range) {
    return range === "1y" ? "week" : "month";
}

// Minimum spacing used only when a map anchor sits too close to a filler.
export function minGapMs(period) {
    if (period === "month") return 10 * MS_PER_DAY;
    if (period === "week") return 4 * MS_PER_DAY;
    return 0;
}

// Every timestamp the trends can plot (snapshot times + decay build times),
// used to anchor the "max" domain to the real data extent.
export function collectTimestamps(network, sources) {
    const out = [];
    for (const source of sources) {
        const data = network.sources[source];
        for (const sn of data.snapshots) out.push(toMs(sn.timestamp));
        for (const p of data.decay.points) out.push(toMs(p.build_timestamp));
    }
    return out;
}

// Drop the slots before ``cutoff`` while keeping valueAt addressable by
// remapping each surviving slot back to its original index.
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

// Upper-bound twin of clampTimeline: drop slots ABOVE ``ceiling``. The decay
// age axis is windowed this way - age = reference − build date, so a calendar
// range maps to a max map age of the same width ("the last year" -> "ages up to
// ~365 days"). Anchored at the reference build, not "now", so the two share a
// width but not the exact build set.
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

// Stable numeric key for a UTC calendar period. Weeks start Monday (ISO-style
// wall clock, not epoch/7), months are year*12+month so they sort chronologically.
export function periodKey(tsMs, period = "week") {
    const d = new Date(tsMs);
    if (period === "day") {
        return Math.floor(tsMs / MS_PER_DAY);
    }
    if (period === "month") {
        return d.getUTCFullYear() * 12 + d.getUTCMonth();
    }
    // week (default): Monday-start UTC date as epoch days.
    const day = d.getUTCDay(); // 0 = Sun .. 6 = Sat
    const mondayOffset = day === 0 ? 6 : day - 1;
    const weekStart = Date.UTC(
        d.getUTCFullYear(),
        d.getUTCMonth(),
        d.getUTCDate() - mondayOffset,
    );
    return Math.floor(weekStart / MS_PER_DAY);
}

// True when this snapshot is the first crawl scored against a new ASmap build.
export function isBuildChangeSnapshot(snapshots, index) {
    if (!Array.isArray(snapshots) || index < 0 || index >= snapshots.length) {
        return false;
    }
    const buildTs = snapshots[index].build?.timestamp;
    if (buildTs == null) return false;
    if (index === 0) return true;
    return snapshots[index - 1].build?.timestamp !== buildTs;
}

// Crawl timestamps (ms) of every build-change snapshot, in order.
export function buildChangeTimestamps(snapshots) {
    const out = [];
    if (!Array.isArray(snapshots)) return out;
    for (let i = 0; i < snapshots.length; i++) {
        if (isBuildChangeSnapshot(snapshots, i)) {
            out.push(toMs(snapshots[i].timestamp));
        }
    }
    return out;
}

// Union of build-change crawl times across the plotted sources.
export function unionBuildChangeAnchors(network, sources) {
    const set = new Set();
    for (const source of sources) {
        for (const ts of buildChangeTimestamps(network.sources[source]?.snapshots)) {
            set.add(ts);
        }
    }
    return [...set].sort((a, b) => a - b);
}

// Resolve clumps that involve a map anchor. Ordinary neighbouring period
// fillers are left alone so a Sunday/Monday week boundary stays two slots.
export function thinCloseSamples(items, getTs, isAnchor, minGap) {
    if (!minGap || items.length < 2) return items;
    const out = [];
    for (const item of items) {
        if (out.length === 0) {
            out.push(item);
            continue;
        }
        const prev = out[out.length - 1];
        const gap = getTs(item) - getTs(prev);
        if (gap >= minGap) {
            out.push(item);
            continue;
        }
        const itemAnchor = isAnchor(item);
        const prevAnchor = isAnchor(prev);
        if (!itemAnchor && !prevAnchor) {
            out.push(item);
        } else if (itemAnchor && !prevAnchor) {
            out[out.length - 1] = item;
        } else if (itemAnchor && prevAnchor) {
            out.push(item);
        }
        // filler after a nearby map: drop the filler
    }
    return out;
}

// One slot per calendar period. Fillers take each source's earliest sample in
// the period (even week spacing). Periods that contain ``anchorTs`` map-change
// crawls use those crawls instead, so the map landing is the visible point.
export function periodUnionTimeline(entries, period = "week", options = {}) {
    const anchorSet = new Set(options.anchorTs ?? []);
    const byPeriod = new Map();
    const exact = new Map(); // source -> Map(ts -> value)

    for (const entry of entries) {
        const exactMap = new Map();
        for (const point of entry.points) {
            const key = periodKey(point.ts, period);
            let bucket = byPeriod.get(key);
            if (!bucket) {
                bucket = {
                    ts: point.ts,
                    values: new Map(),
                    valueTs: new Map(),
                    anchors: [],
                };
                byPeriod.set(key, bucket);
            }
            if (point.ts < bucket.ts) bucket.ts = point.ts;
            if (anchorSet.has(point.ts)) bucket.anchors.push(point.ts);
            if (point.value == null) continue;
            // Earliest sample per source wins for filler slots.
            const prevTs = bucket.valueTs.get(entry.source);
            if (prevTs == null || point.ts < prevTs) {
                bucket.values.set(entry.source, point.value);
                bucket.valueTs.set(entry.source, point.ts);
            }
            exactMap.set(point.ts, point.value);
        }
        exact.set(entry.source, exactMap);
    }

    const candidates = [];
    const keys = [...byPeriod.keys()].sort((a, b) => a - b);
    for (const key of keys) {
        const bucket = byPeriod.get(key);
        const anchors = [...new Set(bucket.anchors)].sort((a, b) => a - b);
        if (anchors.length > 0) {
            for (const ts of anchors) {
                const values = new Map();
                for (const [source, map] of exact) {
                    if (map.has(ts) && map.get(ts) != null) {
                        values.set(source, map.get(ts));
                    }
                }
                if (values.size > 0) {
                    candidates.push({ ts, values, isAnchor: true });
                }
            }
        } else {
            candidates.push({
                ts: bucket.ts,
                values: bucket.values,
                isAnchor: false,
            });
        }
    }

    const thinned = thinCloseSamples(
        candidates,
        (c) => c.ts,
        (c) => c.isAnchor,
        minGapMs(period),
    );
    const timestamps = thinned.map((c) => c.ts);
    const slots = new Map(thinned.map((c) => [c.ts, c.values]));
    return {
        timestamps,
        valueAt: (source, slot) => {
            const value = slots.get(timestamps[slot])?.get(source);
            return value == null ? null : value;
        },
    };
}

// Kept for callers/tests that still want one slot per calendar day.
export function dayUnionTimeline(entries) {
    return periodUnionTimeline(entries, "day");
}

// Keep the earliest snapshot in each calendar period (after the range cutoff).
export function downsampleSnapshots(snapshots, cutoff, period = "week") {
    const byPeriod = new Map();
    for (const sn of snapshots) {
        const ts = toMs(sn.timestamp);
        if (ts < cutoff) continue;
        const key = periodKey(ts, period);
        const prev = byPeriod.get(key);
        if (!prev || ts < toMs(prev.timestamp)) byPeriod.set(key, sn);
    }
    return [...byPeriod.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, sn]) => sn);
}

// One snapshot per zoom period: map-change crawl(s) when the period has any,
// otherwise the period's earliest crawl. Then drop fillers that sit on top of
// a nearby map point.
export function selectDisplaySnapshots(snapshots, cutoff, period = "week") {
    if (!Array.isArray(snapshots)) return [];

    const periodFirst = new Map();
    const periodMaps = new Map();
    for (let i = 0; i < snapshots.length; i++) {
        const sn = snapshots[i];
        const ts = toMs(sn.timestamp);
        if (ts < cutoff) continue;
        const key = periodKey(ts, period);
        const prev = periodFirst.get(key);
        if (!prev || ts < toMs(prev.timestamp)) periodFirst.set(key, sn);
        if (isBuildChangeSnapshot(snapshots, i)) {
            const list = periodMaps.get(key) ?? [];
            list.push(sn);
            periodMaps.set(key, list);
        }
    }

    const candidates = [];
    for (const key of [...periodFirst.keys()].sort((a, b) => a - b)) {
        const maps = periodMaps.get(key);
        if (maps?.length) {
            for (const sn of maps) {
                candidates.push({ sn, isAnchor: true });
            }
        } else {
            candidates.push({ sn: periodFirst.get(key), isAnchor: false });
        }
    }

    return thinCloseSamples(
        candidates,
        (c) => toMs(c.sn.timestamp),
        (c) => c.isAnchor,
        minGapMs(period),
    ).map((c) => c.sn);
}
