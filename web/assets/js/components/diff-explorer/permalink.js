// Sharable diff permalinks. The Map A / Map B selection is
// reflected into the URL hash so a copy-paste of the address
// bar reopens the dashboard on the same pair:
//
//   #diff?a=YYYY-MM-DD&b=YYYY-MM-DD
//
// Dates are taken from each map's released_at field rather than
// the internal name (e.g. "2026/1770307200") so the URL stays
// human-readable when pasted into chat or a PR comment. The tab
// router in tabs.js already tolerates the "?<query>" suffix on
// any tab token.

const HASH_TAB = "#diff";

export function readPermalink() {
    const raw = window.location.hash;
    const qStart = raw.indexOf("?");
    if (qStart < 0) return {};
    const params = new URLSearchParams(raw.slice(qStart + 1));
    return { a: params.get("a"), b: params.get("b") };
}

// Update the hash without triggering a hashchange listener
// somewhere upstream. replaceState collapses the URL bar update
// into a single history entry per diff selection so the back
// button still steps through user-visible tab changes, not
// every micro-edit to the dropdown pair.
export function writePermalink(aDate, bDate) {
    const params = new URLSearchParams();
    if (aDate) params.set("a", aDate);
    if (bDate) params.set("b", bDate);
    const query = params.toString();
    const next = query ? `${HASH_TAB}?${query}` : HASH_TAB;
    if (window.location.hash === next) return;
    history.replaceState(null, "", next);
}
