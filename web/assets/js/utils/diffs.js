// Shared lookup helpers for the precomputed pair diffs in
// metrics.json. Each pair is stored exactly once with from < to
// chronologically; symmetric callers (drift, headline match-rate)
// don't care which direction we found it in, so they can read the
// raw record and use only the symmetric fields. Asymmetric callers
// (Diff Explorer) own their own inversion logic on top of this.

import { unfilledProfile } from "./map-variants.js";

// Drift unit keys. Two parallel "currencies" the pipeline records
// for every diff:
//
//   DRIFT_IPV4_COVERAGE: IPv4 addresses whose ASN changed, divided
//     by the union of the two maps' mapped IPv4 space (addresses
//     either map assigns an ASN to). The default headline metric —
//     answers the operationally honest question "how much of the
//     IPv4 routing has moved?". The union is the one denominator
//     every changed prefix is guaranteed to fall under, so the
//     ratio can never exceed 1.
//   DRIFT_IPV6_COVERAGE: same for IPv6. Kept separate from v4
//     because Bitcoin Core peer diversity treats the two families
//     as independent dimensions and because the address spaces
//     cannot be meaningfully summed (2^32 vs 2^128 means IPv4
//     would round to noise inside a combined denominator).
//
// The raw "entries" view (one row per trie leaf changed) is
// intentionally not exposed in the UI: it weights a /8 the same as
// a /48 and is dominated by IPv6 trie geometry — the exact failure
// mode the coverage views avoid. Reviewers who want the trie-leaf
// reading can still see it via the asmap CLI, which prints the
// same numbers the pipeline reads.
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
// from=fromName, to=toName. The pipeline emits each pair once with
// from < to chronologically, so callers passing (older, newer) hit
// the canonical direction. Asymmetric callers (Diff Explorer, drift
// chart) need this rather than findDiff's symmetric fallback, because
// the category fields (reassigned, newly_mapped, unmapped) only make
// sense in the canonical direction.
export function findDirectionalDiff(diffs, fromName, toName) {
    if (!Array.isArray(diffs)) return null;
    return diffs.find((d) => d.from === fromName && d.to === toName) || null;
}

// Compute the two drift views for a single diff record. Returns
// the shape every consumer (overview card, match banner, drift
// chart points) reads from, so the headline match-rate, the
// vs-previous card, and the chart can never disagree on what
// "5% drift" means for the same pair.
//
// Each view exposes:
//   ratio:        changed / union of both maps' mapped space. Zero
//                 when neither side has any of that resource (e.g.
//                 a tiny map with no IPv6 entries returns
//                 ipv6_coverage.ratio = 0 cleanly instead of NaN).
//   changed:      raw count of the changing addresses so tooltips
//                 can render exact figures.
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

// Find the most recent build before `name` whose unfilled variant
// is present, i.e. the last build that can be diffed against in
// the source-data sense. Returns null if no such predecessor
// exists, which only happens for the very oldest published build.
//
// "Diffable" here matches the rule the precomputed diffs use:
// each pair is computed unfilled-vs-unfilled, so any filled-only
// build is invisible to this lookup. The drift card and the step-
// mode drift chart both call this helper so they show the same
// "vs <date>" reference build for any build that follows a
// filled-only one.
export function previousDiffable(maps, name) {
    if (!Array.isArray(maps)) return null;
    const idx = maps.findIndex((m) => m.name === name);
    if (idx <= 0) return null;
    for (let i = idx - 1; i >= 0; i--) {
        if (unfilledProfile(maps[i])) return maps[i];
    }
    return null;
}
