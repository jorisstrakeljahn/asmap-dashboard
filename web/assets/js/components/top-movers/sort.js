// Sort + derived-metric helpers for the Top Movers table.
// directionRank() is reused by filter.js so sort and filter never
// disagree on what counts as "gained" vs "lost".
//
// All helpers take a ``unit`` argument: the table renders one
// currency at a time (IPv4 addresses moved, IPv6 addresses
// moved) and the user picker flips it. Sorting "biggest mover
// first" therefore depends on which currency is active, so does
// the gained/lost direction classification (an AS that only
// gained IPv6 prefixes should not classify as "gained" in the
// IPv4 view). Routing the unit through here keeps that single
// truth.

import { accessorsFor } from "./units.js";

// Shallow copy so diff.top_movers stays untouched. Array.sort is
// stable since ES2019, so the metrics.json input order survives
// as the tiebreaker.
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

// Active-currency change count over the larger per-side
// presence in the same currency. Values above 1.0 are
// intentional and surface fragmentation events — see the
// user-facing tooltip ``topMovers.info`` in en.json. Capping to
// 100 % would hide exactly that signal.
export function touchedRatio(row, unit) {
    const accessors = accessorsFor(unit);
    const presence = Math.max(
        accessors.rowPresenceA(row),
        accessors.rowPresenceB(row),
    );
    return presence > 0 ? accessors.rowChanges(row) / presence : 0;
}

// Classify a row into one of the user-facing flow buckets,
// strictly mutually exclusive so sort and filter agree. The
// active currency drives every read because an AS that only
// gained IPv6 but lost IPv4 belongs in different buckets under
// each picker.
//
// Ranking order (ascending):
//   0 = inactive in this currency (no gain, no loss)
//   1 = gained (gain-only flow; counterpart may be a real AS or
//       0 when the addresses were newly mapped out of the
//       unmapped pool)
//   2 = lost (loss-only flow to a real counterpart AS)
//   3 = exchanged (both gained and lost; counterpart may be 0
//       when the dominant flow is to/from the unmapped pool)
//   4 = unmapped (loss-only flow to the unmapped pool — the
//       addresses disappear from the routing table entirely)
//
// The four user-visible buckets stay mutually exclusive because
// every flow falls into exactly one branch. "Inactive" rows
// (rank 0) are union-included from another currency's ranking
// and have nothing to say in the active currency; they sort to
// the top under ascending and the bottom under descending order
// without crowding the buckets.
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
