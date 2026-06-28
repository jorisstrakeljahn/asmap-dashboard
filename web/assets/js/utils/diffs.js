// Lookup helpers for the precomputed pair diffs in metrics.json. Pairs are
// stored once with from < to; symmetric callers (drift, match-rate) read the
// symmetric fields, asymmetric callers (Diff Explorer) layer their own
// inversion on top.

import { unfilledProfile } from "./map-variants.js";

// Two parallel drift "currencies" per diff: changed address space over the
// union of both maps' mapped space for that family. The union is the one
// denominator every changed prefix falls under, so the ratio can't exceed 1.
// Families stay separate - 2^32 vs 2^128 can't be summed without IPv4 rounding
// to noise. The raw per-leaf "entries" view is omitted: it weights a /8 like a
// /48 and is dominated by IPv6 trie geometry (still on the asmap CLI).
export const DRIFT_IPV4_COVERAGE = "ipv4_coverage";
export const DRIFT_IPV6_COVERAGE = "ipv6_coverage";

export function findDiff(diffs, fromName, toName) {
    if (!Array.isArray(diffs)) return null;
    return diffs.find(
        (d) =>
            (d.from === fromName && d.to === toName) ||
            (d.from === toName && d.to === fromName),
    ) || null;
}

// Strict directional lookup (only from=fromName, to=toName). Asymmetric
// callers need this over findDiff because the category fields (reassigned,
// newly_mapped, unmapped) only make sense in the canonical from < to direction.
export function findDirectionalDiff(diffs, fromName, toName) {
    if (!Array.isArray(diffs)) return null;
    return diffs.find((d) => d.from === fromName && d.to === toName) || null;
}

// The two drift views for one diff, in the single shape every consumer reads
// so none can disagree on what "5% drift" means. ratio is 0 (not NaN) when
// neither side has the resource; raw changed + denominator ride along for
// exact tooltips.
export function driftViews(diff) {
    return {
        [DRIFT_IPV4_COVERAGE]: coverageView(
            diff.ipv4_addresses_changed,
            diff.ipv4_address_space_union,
        ),
        [DRIFT_IPV6_COVERAGE]: coverageView(
            diff.ipv6_addresses_changed,
            diff.ipv6_address_space_union,
        ),
    };
}

function coverageView(changed, unionSpace) {
    const denominator = unionSpace || 0;
    const ratio = denominator ? (changed || 0) / denominator : 0;
    return { ratio, changed: changed || 0, denominator };
}

// Drift between two builds in both currencies. Null when the pair has no
// stored diff (e.g. one side lacks an unfilled variant).
export function pairDriftRatio(diffs, fromName, toName) {
    const diff = findDiff(diffs, fromName, toName);
    return diff ? driftViews(diff) : null;
}

// Most recent diffable predecessor of `name`: the last build with an unfilled
// variant (matching the unfilled-vs-unfilled diff rule, so filled-only builds
// are invisible). Null only for the oldest build. Shared by the drift card and
// step-mode chart so both show the same "vs <date>" reference.
export function previousDiffable(maps, name) {
    if (!Array.isArray(maps)) return null;
    const idx = maps.findIndex((m) => m.name === name);
    if (idx <= 0) return null;
    for (let i = idx - 1; i >= 0; i--) {
        if (unfilledProfile(maps[i])) return maps[i];
    }
    return null;
}
