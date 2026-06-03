// Sharable Map A / Map B permalink: ``#diff?a=YYYY-MM-DD&b=YYYY-MM-DD``.
// Dates rather than internal names so the URL stays readable
// when pasted into a PR comment. The tab router tolerates the
// "?<query>" suffix on any tab token.

const HASH_TAB = "#diff";

export function readPermalink() {
    const raw = window.location.hash;
    const qStart = raw.indexOf("?");
    if (qStart < 0) return {};
    const params = new URLSearchParams(raw.slice(qStart + 1));
    return { a: params.get("a"), b: params.get("b") };
}

// replaceState (not pushState) so the back button still steps
// through user-visible tab changes, not every dropdown tweak.
//
// Guard: only touch the hash while the diff tab is the active one.
// The selectors call this during their initial setSelection on mount,
// which runs for every page load regardless of the visible tab; without
// the guard that initial write would rewrite the hash to "#diff" and
// hijack a reload that landed on Maps or Network.
export function writePermalink(aDate, bDate) {
    const token = window.location.hash.replace(/^#/, "").split("?", 1)[0];
    if (token !== "diff") return;
    const params = new URLSearchParams();
    if (aDate) params.set("a", aDate);
    if (bDate) params.set("b", bDate);
    const query = params.toString();
    const next = query ? `${HASH_TAB}?${query}` : HASH_TAB;
    if (window.location.hash === next) return;
    history.replaceState(null, "", next);
}
