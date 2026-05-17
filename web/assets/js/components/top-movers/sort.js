// Sort + derived-metric helpers for the Top Movers table.
// directionRank() is reused by filter.js so sort and filter never
// disagree on what counts as "gained" vs "lost".

// Shallow copy so diff.top_movers stays untouched. Array.sort is
// stable since ES2019, so the metrics.json input order survives
// as the tiebreaker.
export function sortMovers(movers, field, dir) {
    const copy = movers.slice();
    copy.sort((a, b) => compareMovers(a, b, field, dir));
    return copy;
}

export function compareMovers(a, b, field, dir) {
    const sign = dir === "asc" ? 1 : -1;
    if (field === "asn") return sign * (a.asn - b.asn);
    if (field === "changes") return sign * (a.changes - b.changes);
    if (field === "touched") return sign * (touchedRatio(a) - touchedRatio(b));
    if (field === "direction") {
        return sign * (directionRank(a) - directionRank(b));
    }
    return 0;
}

// Trie-diff entry count over the larger per-side prefix count.
// Values above 1.0 are intentional and surface fragmentation
// events — see the user-facing tooltip ``topMovers.info`` in
// en.json. Capping to 100 % would hide exactly that signal.
export function touchedRatio(row) {
    const presence = Math.max(row.entries_in_a ?? 0, row.entries_in_b ?? 0);
    return presence > 0 ? row.changes / presence : 0;
}

// Ascending order reads as gained -> lost -> exchanged ->
// unmapped. Same buckets as describeFlow() in rows.js.
export function directionRank(row) {
    if (!row.primary_counterpart) return 4; // -> unmapped
    const gained = row.gained ?? 0;
    const lost = row.lost ?? 0;
    if (gained > 0 && lost > 0) return 3; // exchanged
    if (gained > 0) return 1;
    if (lost > 0) return 2;
    // Older payloads (gained/lost both undefined) fall through
    // to "exchanged" in describeFlow().
    return 3;
}
