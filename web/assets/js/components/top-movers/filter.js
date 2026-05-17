// Substring + direction filtering for the Top Movers rows. The
// substring matcher accepts "16509", "AS16509", or operator-name
// fragments; direction reuses directionRank() from sort.js so
// filter and sort never disagree.

import { nameFor } from "../../asn-names.js";
import { directionRank } from "./sort.js";

// Display order. Labels come from i18n (``topMovers.direction.*``).
export const DIRECTION_FILTER_VALUES = [
    "all",
    "gained",
    "lost",
    "exchanged",
    "unmapped",
];

const DIRECTION_FILTER_RANKS = {
    all: null,
    gained: 1,
    lost: 2,
    exchanged: 3,
    unmapped: 4,
};

export function filterMovers(movers, filterText, filterDirection) {
    const needle = filterText.trim().toLowerCase();
    const directionRankWanted = DIRECTION_FILTER_RANKS[filterDirection] ?? null;
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
