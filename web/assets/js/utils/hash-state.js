// Generic per-tab hash query-string state.
//
// Each tab owns the "?<query>" suffix on its own hash token, e.g.
// "#maps?range=3y". The router (tabs.js) reads only the leading
// token, so a tab can keep sharable view state in the suffix.
//
// Callers pass only params that differ from defaults, so a default
// view carries no query; the default tab then drops the fragment
// entirely, other tabs keep their "#tab" token across a reload.
//
// Reads return params only when the named tab is the active one, so
// a deep link never feeds stale params elsewhere. Writes use
// replaceState (back button steps through tab changes, not dropdown
// tweaks) and refuse to touch a hash owned by another tab.
//
// ``stampWhenEmpty`` is for the default tab only: an empty hash has
// no token, so without it the default tab could never write its
// state. Exactly one tab passes it, avoiding an order-dependent race.

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

    // With no non-default state, keep the URL minimal: the default
    // tab drops the fragment, other tabs keep just "#tab" so a reload
    // lands on the same tab.
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
