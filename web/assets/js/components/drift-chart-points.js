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
// All ratios share the same denominator: max(entries_a, entries_b)
// of the underlying diff. That matches the diff explorer's
// match-rate banner and keeps "Total drift" in step mode equal to
// the headline drift figure the overview card shows for the same
// pair.

import { unfilledProfile } from "../utils/variants.js";

// Build one Point per chronological build slot.
//
//   - "cumulative" diffs each build against the oldest published
//     build with an unfilled variant. Lines grow over time and
//     answer "how outdated is an embedded asmap?".
//   - "step" diffs each build against the last preceding build
//     that has an unfilled variant. Highlights the character of
//     each individual asmap-data release.
//   - any other mode produces an all-gap result (defensive default
//     so a malformed caller still renders cleanly).
export function computePoints(sortedMaps, diffs, mode) {
    if (mode === "cumulative") return cumulativePoints(sortedMaps, diffs);
    if (mode === "step") return stepPoints(sortedMaps, diffs);
    return sortedMaps.map((map, index) => gapPoint(map, index));
}

function cumulativePoints(sortedMaps, diffs) {
    // Anchor on the oldest build that actually published an unfilled
    // variant. The single filled-only build (2025-03-21) cannot
    // contribute a diff and would shift the anchor forward in time
    // for everything after it, which would silently relabel the
    // baseline. Filtering keeps the anchor stable and honest.
    const baseline = sortedMaps.find((m) => unfilledProfile(m) !== null);
    if (!baseline) return sortedMaps.map((m, i) => gapPoint(m, i));

    return sortedMaps.map((map, index) => {
        if (map.name === baseline.name) {
            return zeroPoint(map, index, baseline);
        }
        const diff = directionalDiff(diffs, baseline.name, map.name);
        return diff ? toPoint(map, index, diff, baseline) : gapPoint(map, index);
    });
}

function stepPoints(sortedMaps, diffs) {
    // "Previous" means "previous build that can actually be diffed
    // against", which excludes filled-only builds. If we picked the
    // raw chronological neighbour, the build immediately after a
    // filled-only one would always show as a gap because its
    // neighbour has no unfilled variant. Skipping over filled-only
    // neighbours produces the step the user expects, with the
    // tooltip footer naming the actual reference build.
    return sortedMaps.map((map, index) => {
        if (!unfilledProfile(map)) return gapPoint(map, index);
        const previous = lastDiffableBefore(sortedMaps, index);
        if (!previous) return zeroPoint(map, index, null);
        const diff = directionalDiff(diffs, previous.name, map.name);
        return diff ? toPoint(map, index, diff, previous) : gapPoint(map, index);
    });
}

function lastDiffableBefore(sortedMaps, index) {
    for (let i = index - 1; i >= 0; i--) {
        if (unfilledProfile(sortedMaps[i])) return sortedMaps[i];
    }
    return null;
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

function toPoint(map, index, diff, vs) {
    const denom = Math.max(diff.entries_a, diff.entries_b);
    const ratio = (n) => (denom ? n / denom : 0);
    return {
        present: true,
        map,
        index,
        vs,
        denominator: denom,
        reassigned: diff.reassigned,
        newly_mapped: diff.newly_mapped,
        unmapped: diff.unmapped,
        total_changes: diff.total_changes,
        reassigned_ratio: ratio(diff.reassigned),
        newly_ratio: ratio(diff.newly_mapped),
        unmapped_ratio: ratio(diff.unmapped),
        total_ratio: ratio(diff.total_changes),
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
