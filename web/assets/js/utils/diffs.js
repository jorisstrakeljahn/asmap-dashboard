// Shared lookup helper for the precomputed pair diffs in
// metrics.json. Each pair is stored exactly once with from < to
// chronologically; symmetric callers (drift, headline match-rate)
// don't care which direction we found it in, so they can read the
// raw record and use only the symmetric fields (entries_a / b,
// total_changes). Asymmetric callers (Diff Explorer) own their own
// inversion logic on top of this.

import { unfilledProfile } from "./variants.js";

export function findDiff(diffs, fromName, toName) {
    if (!Array.isArray(diffs)) return null;
    return diffs.find(
        (d) =>
            (d.from === fromName && d.to === toName) ||
            (d.from === toName && d.to === fromName),
    ) || null;
}

// Drift between two builds expressed as the share of mapping
// entries that differ. Same denominator the diff explorer uses for
// the headline match-rate, so a 5% drift here lines up with a 95%
// match banner there. Returns null when the pair has no stored
// diff.
export function pairDriftRatio(diffs, fromName, toName) {
    const diff = findDiff(diffs, fromName, toName);
    if (!diff) return null;
    const denom = Math.max(diff.entries_a, diff.entries_b);
    if (!denom) return 0;
    return {
        ratio: diff.total_changes / denom,
        total_changes: diff.total_changes,
    };
}

// Find the most recent build before `name` whose unfilled variant
// is present, i.e. the last build that can be diffed against in
// the source-data sense. Returns null if no such predecessor
// exists, which only happens for the very oldest published build.
//
// "Diffable" here matches the rule the precomputed diffs use:
// each pair is computed unfilled-vs-unfilled, so a filled-only
// build (currently 2025-03-21) is invisible to this lookup. The
// drift card and the step-mode drift chart both call this helper
// so they show the same "vs <date>" reference build for any
// build that follows a filled-only one.
export function previousDiffable(maps, name) {
    if (!Array.isArray(maps)) return null;
    const idx = maps.findIndex((m) => m.name === name);
    if (idx <= 0) return null;
    for (let i = idx - 1; i >= 0; i--) {
        if (unfilledProfile(maps[i])) return maps[i];
    }
    return null;
}
