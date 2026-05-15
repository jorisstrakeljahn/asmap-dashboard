// Shared lookup helper for the precomputed pair diffs in
// metrics.json. Each pair is stored exactly once with from < to
// chronologically; symmetric callers (drift, headline match-rate)
// don't care which direction we found it in, so they can read the
// raw record and use only the symmetric fields (entries_a / b,
// total_changes). Asymmetric callers (Diff Explorer) own their own
// inversion logic on top of this.

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
