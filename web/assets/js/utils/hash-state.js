// Generic per-tab hash query-string state.
//
// Each tab owns the "?<query>" suffix on its own hash token, e.g.
// "#maps?range=3y" or "#diff?a=…&b=…". The top-level router (tabs.js)
// only reads the leading token and ignores the suffix, so a tab is free
// to keep sharable view state here.
//
// The URL stays as quiet as possible: callers pass only the params that
// differ from a tab's defaults, so a tab on its default view carries no
// query at all. The default tab then drops the fragment entirely (a bare
// URL); other tabs keep just their "#tab" token so the active tab
// survives a reload.
//
// Reads return params only when the named tab is the one in the hash, so
// a deep link to one tab never feeds stale params to another. Writes use
// replaceState (not pushState) so the back button steps through
// user-visible tab changes, not every dropdown tweak — and refuse to
// touch the hash unless the tab is the active one, so a tab's mount-time
// write can't hijack a hash that landed on a different tab.
//
// ``stampWhenEmpty`` is for the default tab only (the one the router
// shows when the hash is empty): an empty hash carries no token, so the
// default tab would otherwise never be able to write its state. Exactly
// one tab should pass it, so an empty-hash load has a single, predictable
// writer rather than an order-dependent race.

function activeToken() {
    return window.location.hash.replace(/^#/, "").split("?", 1)[0];
}

export function readHashState(tab) {
    const raw = window.location.hash;
    if (activeToken() !== tab) return new URLSearchParams();
    const qStart = raw.indexOf("?");
    return new URLSearchParams(qStart < 0 ? "" : raw.slice(qStart + 1));
}

export function writeHashState(tab, params, { stampWhenEmpty = false } = {}) {
    const token = activeToken();
    const ownsHash = token === tab || (stampWhenEmpty && token === "");
    if (!ownsHash) return;

    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value != null && value !== "") search.set(key, String(value));
    }
    const query = search.toString();

    // With no non-default state, keep the URL minimal: the default tab
    // drops the fragment completely (cleanest bare URL), every other tab
    // keeps just its "#tab" token so a reload lands on the same tab.
    let next;
    if (query) next = `#${tab}?${query}`;
    else if (stampWhenEmpty) next = "";
    else next = `#${tab}`;

    if (window.location.hash === next) return;
    if (next === "") {
        // Strip the fragment without a reload and without leaving a bare "#".
        history.replaceState(
            null,
            "",
            window.location.pathname + window.location.search,
        );
        return;
    }
    history.replaceState(null, "", next);
}
