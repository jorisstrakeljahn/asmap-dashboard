// Pure sort + derived-metric helpers for the Top Movers table.
//
// Everything here is DOM-free so the same function calls feed
// both the rendered table and the sort logic without a second
// source of truth. The sort comparator and the direction filter
// agree on a single ranking via directionRank().

// Stable sort over a shallow copy so the cached diff.top_movers
// array on the payload stays untouched. JavaScript's Array.sort
// is stable since ES2019, so a fresh sort by direction keeps the
// metrics.json input order (by changes desc) as the tiebreaker
// for rows in the same flow category.
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

// Significance multiplier used for both the "Touched" column and
// its sort key. The denominator is the larger of the per-AS
// prefix counts on either side, so the ratio has a stable
// interpretation: "the diff visited this many trie positions for
// every prefix this AS holds in the larger snapshot".
//
// Values above 1.0 are real — and they are not a bug. ``changes``
// is counted at the binary trie's diff granularity, which walks
// to the finest split present anywhere in the comparison; the
// per-AS prefix count is measured at leaf granularity, which
// aggregates contiguous ranges. When one map holds an AS as a
// single large block (one leaf) and the other splits the same
// range into many small pieces (many leafs), the diff visits one
// position per fine-grained piece, but the leaf count stays at
// one or close to it. That is what makes the multiplier exceed 1
// — see the tooltip in controls.js (TOP_MOVERS_INFO) for the
// user-facing explanation. We expose the raw multiplier on
// purpose; capping it to 100 % would hide the very fragmentation
// event Bitcoin Core reviewers want to spot.
//
// Rows without per-side counts (older payloads or ASes whose
// presence is zero on both sides) collapse to 0 so the sort
// stays well-defined and the cell can render a dash.
export function touchedRatio(row) {
    const presence = Math.max(row.entries_in_a ?? 0, row.entries_in_b ?? 0);
    return presence > 0 ? row.changes / presence : 0;
}

// Ordinal rank used to sort the Direction column. Ascending sort
// produces gained -> lost -> exchanged -> unmapped, which reads
// as "what kind of flow happened" rather than the underlying
// counterpart number. The same buckets feed describeFlow() in
// rows.js, so the ranking matches whatever glyph the cell
// renders.
export function directionRank(row) {
    if (!row.primary_counterpart) return 4; // -> unmapped
    const gained = row.gained ?? 0;
    const lost = row.lost ?? 0;
    if (gained > 0 && lost > 0) return 3; // exchanged
    if (gained > 0) return 1;
    if (lost > 0) return 2;
    // Older payloads without per-direction counts (gained/lost both
    // undefined) collapse onto "exchanged" via describeFlow(); match
    // that ranking so the sort agrees with what the cell shows.
    return 3;
}
