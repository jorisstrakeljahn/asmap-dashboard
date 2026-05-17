// Substring + direction filtering for the Top Movers rows.
//
// Substring is case-insensitive and matches either "AS<num>" or
// the operator label from asn-names.json; users can paste either
// a number ("16509"), the AS-prefixed form ("AS16509"), or part
// of an operator ("amazon"). Direction filter compares against
// directionRank() in sort.js so the same numbers feed both the
// sort and the filter without a second source of truth.

import { ARROW } from "../../utils/symbols.js";
import { nameFor } from "../../asn-names.js";
import { directionRank } from "./sort.js";

// Direction-filter facet. ``rank`` values agree with
// directionRank() so the same numbers drive both the sort and
// the filter. "all" disables the filter entirely; ``rank: null``
// on the "all" row keeps the lookup symmetric without needing a
// dedicated branch.
export const DIRECTION_FILTERS = [
    { value: "all", label: "All flows", rank: null },
    { value: "gained", label: `Gained ${ARROW.UP_RIGHT}`, rank: 1 },
    { value: "lost", label: `Lost ${ARROW.DOWN_RIGHT}`, rank: 2 },
    { value: "exchanged", label: `Exchanged ${ARROW.LEFT_RIGHT}`, rank: 3 },
    { value: "unmapped", label: `Unmapped ${ARROW.RIGHT}`, rank: 4 },
];

export function filterMovers(movers, filterText, filterDirection) {
    const needle = filterText.trim().toLowerCase();
    const direction = DIRECTION_FILTERS.find((d) => d.value === filterDirection);
    const directionRankWanted = direction?.rank ?? null;
    if (!needle && directionRankWanted === null) return movers;
    return movers.filter((row) => {
        if (
            directionRankWanted !== null &&
            directionRank(row) !== directionRankWanted
        ) {
            return false;
        }
        if (!needle) return true;
        return matchesText(row, needle);
    });
}

function matchesText(row, needle) {
    const asnStr = String(row.asn);
    if (asnStr.includes(needle)) return true;
    if (`as${asnStr}`.includes(needle)) return true;
    const operator = nameFor(row.asn);
    if (operator && operator.toLowerCase().includes(needle)) return true;
    return false;
}
