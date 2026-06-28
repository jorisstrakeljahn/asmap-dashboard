// Shared helpers for the Network charts: per-source styling and the
// union-timeline assembly every cross-source line chart needs.
//
// KIT and Bitnodes are crawled on different days, so their snapshots never
// share an x slot. We take the union of every source's timestamps as the slot
// list and let each source report null where it has no snapshot; buildLineChart
// bridges those gaps so each line stays continuous.

import { t } from "../../utils/i18n.js";

// Render + reading order. KIT first because it is the more complete crawl (full
// whois on every node) and is treated as the primary source; the two Bitnodes
// lines ride along as comparison lines. The Bitnodes crawl split in two when
// the original bitnodes.io shut down: "bitnodes" is the frozen b10c archive
// (through Apr 2026), "bitmex" is the bitnod.es / BitMEX continuation. They are
// kept as separate series because BitMEX's vantage point reaches a different
// population, so a single spliced line would fake a concentration jump at the
// handover.
export const SOURCE_ORDER = ["kit", "bitnodes", "bitmex"];

const SOURCE_STYLE = {
    kit: {
        lineClass: "chart__line--kit",
        dotClass: "chart__dot--kit",
        swatchClass: "chart-legend__swatch--kit",
    },
    bitnodes: {
        lineClass: "chart__line--bitnodes",
        dotClass: "chart__dot--bitnodes",
        swatchClass: "chart-legend__swatch--bitnodes",
    },
    bitmex: {
        lineClass: "chart__line--bitmex",
        dotClass: "chart__dot--bitmex",
        swatchClass: "chart-legend__swatch--bitmex",
    },
};

export function sourceLabel(source) {
    return t(`network.source.${source}`);
}

// Build a buildLineChart-ready series descriptor for one source.
export function sourceSeries(source) {
    const style = SOURCE_STYLE[source] ?? SOURCE_STYLE.kit;
    return {
        key: source,
        label: sourceLabel(source),
        lineClass: style.lineClass,
        dotClass: style.dotClass,
        swatchClass: style.swatchClass,
    };
}

// Assemble a union timeline from per-source point arrays.
//
//   entries: [{ source, points: [{ ts, value }] }]  (ts in ms)
//
// Returns { timestamps, valueAt }: ``timestamps`` is the sorted union of every
// entry's ts, ``valueAt(source, slot)`` looks the value up (or null).
export function buildUnionTimeline(entries) {
    const tsSet = new Set();
    const bySource = new Map();
    for (const entry of entries) {
        const map = new Map();
        for (const point of entry.points) {
            tsSet.add(point.ts);
            map.set(point.ts, point.value);
        }
        bySource.set(entry.source, map);
    }
    const timestamps = [...tsSet].sort((a, b) => a - b);
    return {
        timestamps,
        valueAt: (source, slot) => {
            const map = bySource.get(source);
            if (!map) return null;
            const value = map.get(timestamps[slot]);
            return value == null ? null : value;
        },
    };
}

// Snapshot timestamps are unix seconds; charts work in ms.
export function toMs(unixSeconds) {
    return unixSeconds * 1000;
}
