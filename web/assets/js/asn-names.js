// Tiny registry for AS number → operator name lookups. A frontend-only
// convenience layer; metrics.json stays the source of truth for diff
// data. Callers get null for unknown ASNs, so a missing or stale JSON
// file degrades gracefully to bare "AS<num>" rendering.

let names = {};

export async function init(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) return;
        names = await response.json();
    } catch (error) {
        console.warn(`asn-names: failed to load ${url}`, error);
    }
}

export function nameFor(asn) {
    if (asn === 0 || asn === undefined || asn === null) return null;
    return names[asn] || null;
}

// Plain-text label "AS123 (Name)" or "AS123" when no name is known.
// Kept for callers that want a single string (e.g. SVG tooltips).
export function labelFor(asn) {
    if (asn === 0 || asn === undefined || asn === null) return "";
    const name = nameFor(asn);
    return name ? `AS${asn} (${name})` : `AS${asn}`;
}

// Two-line cell: AS number above, operator name below in muted style.
// Intentionally inline-flex (column) so a parent cell can place a
// leading arrow on the same baseline without nested wrappers. Hiding
// the name needs only one CSS rule (`.asn-cell__name { display: none }`)
// — no rerender.
export function asnCell(asn) {
    const wrap = document.createElement("span");
    wrap.className = "asn-cell";

    if (asn === 0 || asn === undefined || asn === null) return wrap;

    const num = document.createElement("span");
    num.className = "asn-cell__num";
    num.textContent = `AS${asn}`;
    wrap.append(num);

    const name = nameFor(asn);
    if (name) {
        const nameEl = document.createElement("span");
        nameEl.className = "asn-cell__name";
        nameEl.textContent = name;
        nameEl.title = name;
        wrap.append(nameEl);
    }

    return wrap;
}
