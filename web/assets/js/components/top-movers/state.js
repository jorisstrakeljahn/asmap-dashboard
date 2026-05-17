// Top-movers state model: defaults, persisted flags, and the
// predicates that read the state object.

import { readFlag, writeFlag } from "../../utils/storage.js";

export const PAGE_SIZES = [10, 25, 50, 100];
export const DEFAULT_PAGE_SIZE = 10;

// "changes desc" matches the metrics.json natural order, so the
// pre-click render is identical to the input baseline.
export const DEFAULT_SORT = { field: "changes", dir: "desc" };

const SHOW_NAMES_KEY = "asmap.topMovers.showNames";

export function loadShowNames() {
    return readFlag(SHOW_NAMES_KEY, true);
}

export function saveShowNames(value) {
    writeFlag(SHOW_NAMES_KEY, value);
}

export function createState() {
    return {
        pageSize: DEFAULT_PAGE_SIZE,
        pageIndex: 0,
        showNames: loadShowNames(),
        sortField: DEFAULT_SORT.field,
        sortDir: DEFAULT_SORT.dir,
        filterText: "",
        filterDirection: "all",
    };
}

export function isFiltering(state) {
    return state.filterText.trim() !== "" || state.filterDirection !== "all";
}
