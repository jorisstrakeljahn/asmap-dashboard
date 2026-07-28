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

// Host/export label for one point on the continuous Bitnodes lineage:
// archived bitnodes.io JSON before the handoff, bitnod.es CSVs from the
// first live export onward. Falls back to the generic lineage name when
// the payload has no transition marker (older network.json).
export function lineageStageLabel(network, tsMs) {
    const transition = network?.source_transition?.timestamp;
    if (transition == null || !Number.isFinite(tsMs)) {
        return sourceLabel("bitnodes");
    }
    return tsMs >= toMs(transition)
        ? t("network.source.bitnodesLive")
        : t("network.source.bitnodesArchive");
}

// Label for the latest snapshot of a source (overview caption, cross-check).
export function latestLineageLabel(network, source = "bitnodes") {
    const snaps = network?.sources?.[source]?.snapshots;
    if (!Array.isArray(snaps) || snaps.length === 0) {
        return sourceLabel(source);
    }
    return lineageStageLabel(network, toMs(snaps[snaps.length - 1].timestamp));
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
