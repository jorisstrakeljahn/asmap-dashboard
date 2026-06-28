// Per-tab hash query-string state: each tab owns the "?<query>" on its own
// token (e.g. "#maps?range=3y") and the router reads only the leading token.
// Callers pass only non-default params, so a default view carries no query.
// Reads return params only when the named tab is active, so a deep link never
// leaks stale params to another tab. Writes use replaceState (Back steps
// through tab changes, not dropdown tweaks) and refuse to touch another tab's
// hash. stampWhenEmpty is for the default tab alone: an empty hash has no
// token, so without it the default tab could never write its state - exactly
// one tab passes it, avoiding an order-dependent race.

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

    // No non-default state: the default tab drops the fragment, other tabs
    // keep just "#tab" so a reload lands on it.
    let next;
    if (query) next = `#${tab}?${query}`;
    else if (stampWhenEmpty) next = "";
    else next = `#${tab}`;

    if (window.location.hash === next) return;
    if (next === "") {
        // Strip the fragment without a reload and without a bare "#".
        history.replaceState(
            null,
            "",
            window.location.pathname + window.location.search,
        );
        return;
    }
    history.replaceState(null, "", next);
}
