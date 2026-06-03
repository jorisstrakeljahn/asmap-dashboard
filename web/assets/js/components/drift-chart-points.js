// Drift chart data layer. Pure functions, no DOM. Turns the
// (maps, diffs) pair from metrics.json into the chronological
// Point list the drift chart plots.
//
// A Point is the "what does the chart render at slot i" record:
// either a present slot carrying the three category counts plus
// their share-of-denominator ratios, or a gap that the renderer
// draws as a break in the line. Points stay index-aligned with
// the sorted map list so the chart's nearestIndex() hover handler
// indexes both consistently.
//
// Every present point is rendered in one drift unit at a time
// (IPv4 coverage, IPv6 coverage, or entries — see DRIFT_* in
// utils/diffs.js). The unit selects which pipeline fields the
// ratios are read from; the rest of the point shape stays
// constant, so the chart renderer does not branch on unit.

import {
    DRIFT_IPV4_COVERAGE,
    DRIFT_IPV6_COVERAGE,
    previousDiffable,
} from "../utils/diffs.js";
import { unfilledProfile } from "../utils/map-variants.js";

// Per-unit accessor table: tells the point builder which pipeline
// field is the bucket count and which two are the per-map totals
// used as the shared denominator. Centralised so adding a new
// unit (e.g. bitnodes-weighted coverage later) only needs one
// entry here, not edits in every consumer.
const UNIT_FIELDS = {
    [DRIFT_IPV4_COVERAGE]: {
        denominatorA: "ipv4_address_space_a",
        denominatorB: "ipv4_address_space_b",
        reassigned: "reassigned_ipv4_addresses",
        newlyMapped: "newly_mapped_ipv4_addresses",
        unmapped: "unmapped_ipv4_addresses",
        total: "ipv4_addresses_changed",
    },
    [DRIFT_IPV6_COVERAGE]: {
        denominatorA: "ipv6_address_space_a",
        denominatorB: "ipv6_address_space_b",
        reassigned: "reassigned_ipv6_addresses",
        newlyMapped: "newly_mapped_ipv6_addresses",
        unmapped: "unmapped_ipv6_addresses",
        total: "ipv6_addresses_changed",
    },
};

// Build one Point per chronological build slot for a single unit.
//
//   - "cumulative" diffs each build against the oldest published
//     build with an unfilled variant. Lines grow over time and
//     answer "how far has this build drifted from the baseline?".
//   - "step" diffs each build against the last preceding build
//     that has an unfilled variant. Highlights the character of
//     each individual asmap-data release.
//   - unknown modes produce an all-gap result (defensive default
//     so a malformed caller still renders cleanly).
export function computePoints(sortedMaps, diffs, mode, unit) {
    const fields = UNIT_FIELDS[unit];
    if (!fields) return sortedMaps.map((map, index) => gapPoint(map, index));
    if (mode === "cumulative") return cumulativePoints(sortedMaps, diffs, fields);
    if (mode === "step") return stepPoints(sortedMaps, diffs, fields);
    return sortedMaps.map((map, index) => gapPoint(map, index));
}

function cumulativePoints(sortedMaps, diffs, fields) {
    // Anchor on the oldest build that actually published an unfilled
    // variant. A filled-only build cannot contribute a diff and would
    // shift the anchor forward in time for everything after it, which
    // would silently relabel the baseline. Filtering keeps the anchor
    // stable and honest.
    const baseline = sortedMaps.find((m) => unfilledProfile(m) !== null);
    if (!baseline) return sortedMaps.map((m, i) => gapPoint(m, i));

    return sortedMaps.map((map, index) => {
        if (map.name === baseline.name) {
            return zeroPoint(map, index, baseline);
        }
        const diff = directionalDiff(diffs, baseline.name, map.name);
        return diff
            ? toPoint(map, index, diff, baseline, fields)
            : gapPoint(map, index);
    });
}

function stepPoints(sortedMaps, diffs, fields) {
    // "Previous" means "previous build that can actually be diffed
    // against", which excludes filled-only builds. If we picked the
    // raw chronological neighbour, the build immediately after a
    // filled-only one would always show as a gap because its
    // neighbour has no unfilled variant. Skipping over filled-only
    // neighbours produces the step the user expects, with the
    // tooltip footer naming the actual reference build.
    return sortedMaps.map((map, index) => {
        if (!unfilledProfile(map)) return gapPoint(map, index);
        const previous = previousDiffable(sortedMaps, map.name);
        if (!previous) return zeroPoint(map, index, null);
        const diff = directionalDiff(diffs, previous.name, map.name);
        return diff
            ? toPoint(map, index, diff, previous, fields)
            : gapPoint(map, index);
    });
}

// Strict directional lookup. The pipeline emits each pair exactly
// once with from < to chronologically, so callers passing
// chronological (older, newer) arguments always hit the canonical
// direction. We never want the symmetric fallback findDiff() in
// utils/diffs.js offers, because the asymmetric category fields
// (reassigned, newly_mapped, unmapped) only make sense in the
// canonical direction.
function directionalDiff(diffs, fromName, toName) {
    return (
        diffs.find((d) => d.from === fromName && d.to === toName) || null
    );
}

function toPoint(map, index, diff, vs, fields) {
    const denom = Math.max(diff[fields.denominatorA], diff[fields.denominatorB]);
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
