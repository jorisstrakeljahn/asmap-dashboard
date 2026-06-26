// Sort + derived-metric helpers for the Top Movers table. directionRank() is
// reused by filter.js so sort and filter never disagree on "gained" vs "lost".
//
// Every helper takes a ``unit``: the table shows one currency at a time, so
// both "biggest mover first" and the gained/lost classification depend on which
// is active (an AS that only gained IPv6 must not read as "gained" under IPv4).
// Routing the unit through here keeps that single truth.

import { accessorsFor } from "./units.js";

// Shallow copy so diff.top_movers stays untouched. Array.sort is stable since
// ES2019, so the metrics.json input order survives as the tiebreaker.
export function sortMovers(movers, field, dir, unit) {
    const copy = movers.slice();
    copy.sort((a, b) => compareMovers(a, b, field, dir, unit));
    return copy;
}

export function compareMovers(a, b, field, dir, unit) {
    const sign = dir === "asc" ? 1 : -1;
    const accessors = accessorsFor(unit);
    if (field === "asn") return sign * (a.asn - b.asn);
    if (field === "share") {
        return sign * (accessors.rowChanges(a) - accessors.rowChanges(b));
    }
    if (field === "direction") {
        return sign * (directionRank(a, unit) - directionRank(b, unit));
    }
    return 0;
}

// Active-currency change count over the larger per-side presence. Values above
// 1.0 are intentional - they surface fragmentation events (see
// ``topMovers.info`` in en.json); capping to 100 % would hide that signal.
export function touchedRatio(row, unit) {
    const accessors = accessorsFor(unit);
    const presence = Math.max(
        accessors.rowPresenceA(row),
        accessors.rowPresenceB(row),
    );
    return presence > 0 ? accessors.rowChanges(row) / presence : 0;
}

// Classify a row into one mutually-exclusive flow bucket so sort and filter
// agree. The active currency drives every read (an AS that gained IPv6 but lost
// IPv4 buckets differently per picker).
//
// Ranking order (ascending):
//   0 = inactive in this currency (no gain, no loss)
//   1 = gained (counterpart 0 = newly mapped from unmapped pool)
//   2 = lost (loss-only to a real counterpart AS)
//   3 = exchanged (gained and lost; counterpart 0 = unmapped pool)
//   4 = unmapped (loss-only to the unmapped pool)
//
// Rank-0 rows are union-included from another currency's ranking; they sort to
// the top (asc) / bottom (desc) without crowding the real buckets.
export function directionRank(row, unit) {
    const accessors = accessorsFor(unit);
    const gained = accessors.rowGained(row);
    const lost = accessors.rowLost(row);
    if (gained === 0 && lost === 0) return 0;
    if (gained > 0 && lost > 0) return 3;
    if (gained > 0) return 1;
    if (!accessors.rowPrimaryCounterpart(row)) return 4;
    return 2;
}
