// Top-movers state model: defaults, persisted flags, and the predicates that
// read the state object. ``unit`` comes from the Diff Explorer family toggle
// via createState(), so a family switch outside the card flips cells, sort, and
// share denominator together.

import { readFlag, writeFlag } from "../../utils/storage.js";
import { DEFAULT_UNIT, familyToUnit } from "./units.js";

export const PAGE_SIZES = [10, 25, 50, 100];
export const DEFAULT_PAGE_SIZE = 10;

// "share desc" matches the metrics.json natural order, so the pre-click render
// equals the input baseline.
export const DEFAULT_SORT = { field: "share", dir: "desc" };

const SHOW_NAMES_KEY = "asmap.topMovers.showNames";

export function loadShowNames() {
    return readFlag(SHOW_NAMES_KEY, true);
}

export function saveShowNames(value) {
    writeFlag(SHOW_NAMES_KEY, value);
}

export function createState({ family } = {}) {
    return {
        pageSize: DEFAULT_PAGE_SIZE,
        pageIndex: 0,
        showNames: loadShowNames(),
        sortField: DEFAULT_SORT.field,
        sortDir: DEFAULT_SORT.dir,
        filterText: "",
        filterDirection: "all",
        unit: family ? familyToUnit(family) : DEFAULT_UNIT,
    };
}

export function isFiltering(state) {
    return state.filterText.trim() !== "" || state.filterDirection !== "all";
}
