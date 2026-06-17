// Shared lookup helpers for the precomputed pair diffs in
// metrics.json. Each pair is stored once with from < to
// chronologically. Symmetric callers (drift, match-rate) read the
// raw record's symmetric fields; asymmetric callers (Diff
// Explorer) layer their own inversion on top.

import { unfilledProfile } from "./map-variants.js";

// Drift unit keys. Two parallel "currencies" recorded per diff:
//
//   DRIFT_IPV4_COVERAGE: IPv4 addresses whose ASN changed, over
//     the union of both maps' mapped IPv4 space. Default headline
//     metric; the union is the one denominator every changed
//     prefix falls under, so the ratio can't exceed 1.
//   DRIFT_IPV6_COVERAGE: same for IPv6. Kept separate because the
//     families are independent dimensions and the spaces can't be
//     summed (2^32 vs 2^128 — IPv4 would round to noise).
//
// The raw "entries" view (one row per changed trie leaf) is not
// exposed: it weights a /8 like a /48 and is dominated by IPv6
// trie geometry, the failure mode the coverage views avoid. It's
// still available via the asmap CLI.
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

// Strict directional lookup: only the record stored exactly as
// from=fromName, to=toName. Pairs are emitted once with from < to,
// so callers passing (older, newer) hit the canonical direction.
// Asymmetric callers need this over findDiff because the category
// fields (reassigned, newly_mapped, unmapped) only make sense in
// the canonical direction.
export function findDirectionalDiff(diffs, fromName, toName) {
    if (!Array.isArray(diffs)) return null;
    return diffs.find((d) => d.from === fromName && d.to === toName) || null;
}

// Compute the two drift views for one diff record. Single shape
// every consumer (overview card, match banner, chart) reads, so
// they can't disagree on what "5% drift" means for a pair.
//
// Each view exposes:
//   ratio:        changed / union of both maps' mapped space; 0
//                 (not NaN) when neither side has the resource.
//   changed:      raw count, so tooltips show exact figures.
//   denominator:  what changed is divided by, for the same reason.
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

// Drift between two builds in both currencies. Returns null when
// the pair has no stored diff (e.g. one side lacks an unfilled
// variant).
export function pairDriftRatio(diffs, fromName, toName) {
    const diff = findDiff(diffs, fromName, toName);
    return diff ? driftViews(diff) : null;
}

// Most recent build before `name` whose unfilled variant exists,
// i.e. the last diffable predecessor. Null only for the oldest
// published build.
//
// "Diffable" matches the precomputed-diff rule: pairs are computed
// unfilled-vs-unfilled, so filled-only builds are invisible here.
// The drift card and step-mode chart share this so both show the
// same "vs <date>" reference.
export function previousDiffable(maps, name) {
    if (!Array.isArray(maps)) return null;
    const idx = maps.findIndex((m) => m.name === name);
    if (idx <= 0) return null;
    for (let i = idx - 1; i >= 0; i--) {
        if (unfilledProfile(maps[i])) return maps[i];
    }
    return null;
}
