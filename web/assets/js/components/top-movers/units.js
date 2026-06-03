// Top Movers unit accessors. The card renders one currency at a
// time (IPv4 addresses moved, IPv6 addresses moved) and lets the
// user flip between them with a picker. Every consumer (sort,
// filter, row rendering, header labels, the "% of all"
// denominator) needs to read the same currency for the table to
// stay consistent, so all the field choices live here and the
// callers receive a fully resolved accessor bundle.
//
// Field bindings come straight from the backend rows produced by
// ``_PerAsActivity.row`` in asmap_dashboard/diff.py, which writes
// the same three currencies side by side on every top_movers
// entry. Adding a currency later (e.g. bitnodes-weighted
// coverage) is one entry in this table plus the matching backend
// row fields; the rest of the component does not branch on unit.

import { FAMILY_IPV4, FAMILY_IPV6 } from "../../format.js";
import { DRIFT_IPV4_COVERAGE, DRIFT_IPV6_COVERAGE } from "../../utils/diffs.js";

export const DEFAULT_UNIT = DRIFT_IPV4_COVERAGE;

// Map the Diff Explorer family toggle value (FAMILY_IPV4 /
// FAMILY_IPV6) onto the top-movers unit key. Keeping the two
// vocabularies separate is intentional: ``family`` is a
// product-level concept the user toggles, ``unit`` is the
// per-cell accessor lookup, and the two could grow apart (e.g.
// a future ``ipv4_buckets`` unit that the family toggle does
// not surface).
export function familyToUnit(family) {
    return family === FAMILY_IPV6 ? DRIFT_IPV6_COVERAGE : DRIFT_IPV4_COVERAGE;
}

// ``family`` rides next to each unit so callers can route a row
// value through formatCoverage() without re-deriving the family
// from a string compare. ``shareDenominatorKey`` resolves to the
// Share column header ("% of all IPv4", "% of all IPv6").
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
