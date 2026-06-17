// Drift chart data layer. Pure functions, no DOM. Turns the
// (maps, diffs) pair into the chronological Point list the chart
// plots.
//
// A Point is either a present slot (three category counts plus
// their share-of-denominator ratios) or a gap drawn as a line
// break. Points stay index-aligned with the sorted map list so
// nearestIndex() can index both.
//
// One drift unit per render (IPv4 or IPv6 coverage — see DRIFT_*
// in utils/diffs.js). The unit only selects which pipeline fields
// the ratios read from; the point shape is constant, so the
// renderer never branches on unit.

import {
    DRIFT_IPV4_COVERAGE,
    DRIFT_IPV6_COVERAGE,
    findDirectionalDiff,
    previousDiffable,
} from "../utils/diffs.js";
import { unfilledProfile } from "../utils/map-variants.js";

// Per-unit field map: which pipeline fields carry the category
// counts and the shared denominator (the union of both maps'
// mapped space — the same quantity driftViews() divides by, so
// chart and cards can't disagree on a ratio). Centralised so a
// new unit needs one entry, not edits across consumers.
const UNIT_FIELDS = {
    [DRIFT_IPV4_COVERAGE]: {
        denominator: "ipv4_address_space_union",
        reassigned: "reassigned_ipv4_addresses",
        newlyMapped: "newly_mapped_ipv4_addresses",
        unmapped: "unmapped_ipv4_addresses",
        total: "ipv4_addresses_changed",
    },
    [DRIFT_IPV6_COVERAGE]: {
        denominator: "ipv6_address_space_union",
        reassigned: "reassigned_ipv6_addresses",
        newlyMapped: "newly_mapped_ipv6_addresses",
        unmapped: "unmapped_ipv6_addresses",
        total: "ipv6_addresses_changed",
    },
};

// Build one Point per build slot for a single unit.
//
//   - "cumulative" diffs each build against the oldest unfilled
//     build: lines grow over time (drift from baseline).
//   - "step" diffs each build against the last preceding unfilled
//     build: the character of each individual release.
//   - unknown modes return all gaps (defensive default).
export function computePoints(sortedMaps, diffs, mode, unit) {
    const fields = UNIT_FIELDS[unit];
    if (!fields) return sortedMaps.map((map, index) => gapPoint(map, index));
    if (mode === "cumulative") return cumulativePoints(sortedMaps, diffs, fields);
    if (mode === "step") return stepPoints(sortedMaps, diffs, fields);
    return sortedMaps.map((map, index) => gapPoint(map, index));
}

function cumulativePoints(sortedMaps, diffs, fields) {
    // Anchor on the oldest build with an unfilled variant. A
    // filled-only build can't contribute a diff and would shift the
    // anchor forward, silently relabelling the baseline.
    const baseline = sortedMaps.find((m) => unfilledProfile(m) !== null);
    if (!baseline) return sortedMaps.map((m, i) => gapPoint(m, i));

    return sortedMaps.map((map, index) => {
        if (map.name === baseline.name) {
            return zeroPoint(map, index, baseline);
        }
        const diff = findDirectionalDiff(diffs, baseline.name, map.name);
        return diff
            ? toPoint(map, index, diff, baseline, fields)
            : gapPoint(map, index);
    });
}

function stepPoints(sortedMaps, diffs, fields) {
    // "Previous" means previous *diffable* build, skipping
    // filled-only neighbours. The raw chronological neighbour of a
    // filled-only build has no unfilled variant and would always
    // render as a gap; skipping gives the expected step, with the
    // footer naming the actual reference build.
    return sortedMaps.map((map, index) => {
        if (!unfilledProfile(map)) return gapPoint(map, index);
        const previous = previousDiffable(sortedMaps, map.name);
        if (!previous) return zeroPoint(map, index, null);
        const diff = findDirectionalDiff(diffs, previous.name, map.name);
        return diff
            ? toPoint(map, index, diff, previous, fields)
            : gapPoint(map, index);
    });
}

function toPoint(map, index, diff, vs, fields) {
    const denom = diff[fields.denominator] || 0;
    const ratio = (value) => (denom ? value / denom : 0);
    const reassigned = diff[fields.reassigned] || 0;
    const newlyMapped = diff[fields.newlyMapped] || 0;
    const unmapped = diff[fields.unmapped] || 0;
    const total = diff[fields.total] || 0;
    return {
        present: true,
        map,
        index,
        vs,
        denominator: denom,
        reassigned,
        newly_mapped: newlyMapped,
        unmapped,
        total_changes: total,
        reassigned_ratio: ratio(reassigned),
        newly_ratio: ratio(newlyMapped),
        unmapped_ratio: ratio(unmapped),
        total_ratio: ratio(total),
    };
}

function zeroPoint(map, index, vs) {
    return {
        present: true,
        map,
        index,
        vs,
        denominator: 0,
        reassigned: 0,
        newly_mapped: 0,
        unmapped: 0,
        total_changes: 0,
        reassigned_ratio: 0,
        newly_ratio: 0,
        unmapped_ratio: 0,
        total_ratio: 0,
    };
}

function gapPoint(map, index) {
    return { present: false, map, index };
}
