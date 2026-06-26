// Top Movers unit accessors. The card shows one currency at a time; every
// consumer (sort, filter, rows, headers, the "% of all" denominator) must read
// the same one, so the field choices live here and callers get a fully resolved
// accessor bundle.
//
// Field bindings come from the backend rows in ``_PerAsActivity.row``
// (asmap_dashboard/diff.py), which writes IPv4 and IPv6 coverage fields side by
// side on every top_movers entry. Adding a currency is one entry here plus the
// matching backend fields; nothing else branches on unit.

import { FAMILY_IPV4, FAMILY_IPV6 } from "../../format.js";
import { DRIFT_IPV4_COVERAGE, DRIFT_IPV6_COVERAGE } from "../../utils/diffs.js";

export const DEFAULT_UNIT = DRIFT_IPV4_COVERAGE;

// Map the Diff Explorer family value (FAMILY_IPV4 / FAMILY_IPV6) onto a unit
// key. The two vocabularies stay separate on purpose: ``family`` is the
// user-facing toggle, ``unit`` is the accessor lookup, and they could grow
// apart (e.g. a future ``ipv4_buckets`` unit the toggle doesn't surface).
export function familyToUnit(family) {
    return family === FAMILY_IPV6 ? DRIFT_IPV6_COVERAGE : DRIFT_IPV4_COVERAGE;
}

// ``family`` rides next to each unit so callers can route a value through
// formatCoverage() without re-deriving it. ``shareDenominatorKey`` is the Share
// column header.
const ACCESSORS = {
    [DRIFT_IPV4_COVERAGE]: {
        family: FAMILY_IPV4,
        rowChanges: (row) => row.ipv4_addresses_changed ?? 0,
        rowGained: (row) => row.ipv4_addresses_gained ?? 0,
        rowLost: (row) => row.ipv4_addresses_lost ?? 0,
        rowPresenceA: (row) => row.ipv4_addresses_in_a ?? 0,
        rowPresenceB: (row) => row.ipv4_addresses_in_b ?? 0,
        rowPrimaryCounterpart: (row) => row.ipv4_primary_counterpart ?? 0,
        diffTotal: (diff) => diff.ipv4_addresses_changed ?? 0,
        shareDenominatorKey: "topMovers.shareDenominator.ipv4",
    },
    [DRIFT_IPV6_COVERAGE]: {
        family: FAMILY_IPV6,
        rowChanges: (row) => row.ipv6_addresses_changed ?? 0,
        rowGained: (row) => row.ipv6_addresses_gained ?? 0,
        rowLost: (row) => row.ipv6_addresses_lost ?? 0,
        rowPresenceA: (row) => row.ipv6_addresses_in_a ?? 0,
        rowPresenceB: (row) => row.ipv6_addresses_in_b ?? 0,
        rowPrimaryCounterpart: (row) => row.ipv6_primary_counterpart ?? 0,
        diffTotal: (diff) => diff.ipv6_addresses_changed ?? 0,
        shareDenominatorKey: "topMovers.shareDenominator.ipv6",
    },
};

export function accessorsFor(unit) {
    return ACCESSORS[unit] ?? ACCESSORS[DEFAULT_UNIT];
}
