// Shared helpers for the Network charts: per-source styling and the
// union-timeline assembly every cross-source line chart needs.
//
// The archived bitnodes.io JSON and daily bitnod.es CSV exports are one
// crawler lineage and therefore one continuous series.

import { t } from "../../utils/i18n.js";

export const SOURCE_ORDER = ["bitnodes"];

const SOURCE_STYLE = {
    bitnodes: {
        lineClass: "chart__line--bitnodes",
        dotClass: "chart__dot--bitnodes",
    },
};

export function sourceLabel(source) {
    return t(`network.source.${source}`);
}

export function attributionProviderLabel(network) {
    const provider = network.reality_attribution?.provider;
    if (provider === "team-cymru") return t("network.whois.teamCymru");
    if (provider === "local-cache") return t("network.whois.localCache");
    return t("network.whois.independent");
}

// Build a buildLineChart-ready series descriptor for one source.
export function sourceSeries(source) {
    const style = SOURCE_STYLE[source] ?? SOURCE_STYLE.bitnodes;
    return {
        key: source,
        label: sourceLabel(source),
        lineClass: style.lineClass,
        dotClass: style.dotClass,
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
