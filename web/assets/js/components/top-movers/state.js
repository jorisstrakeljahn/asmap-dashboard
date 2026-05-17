// Top-movers state model: defaults, persisted preferences, and
// the small predicates that read the state object. Kept in one
// file so the mount orchestrator (index.js) can spin up a fresh
// state without each consumer module having to import its own
// defaults; the sort / filter / pagination submodules read the
// same shape via plain object access.

import { readFlag, writeFlag } from "../../utils/storage.js";

export const PAGE_SIZES = [10, 25, 50, 100];
export const DEFAULT_PAGE_SIZE = 10;

// Initial sort: by changes descending, matching the metrics.json
// payload's natural order so the very first render before any
// click is identical to the pre-sort baseline.
export const DEFAULT_SORT = { field: "changes", dir: "desc" };

const SHOW_NAMES_KEY = "asmap.topMovers.showNames";

export function loadShowNames() {
    return readFlag(SHOW_NAMES_KEY, true);
}

export function saveShowNames(value) {
    writeFlag(SHOW_NAMES_KEY, value);
}

// Fresh state object for one mount() of the Top Movers card.
// The orchestrator mutates the fields below as the user clicks;
// each render passes the object to the sort / filter / paginate
// submodules and they read what they need. Centralising the
// shape keeps the call-site self-documenting.
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
