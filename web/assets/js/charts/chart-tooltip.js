// Declarative builder for the contents of a chart tooltip so each
// chart only has to describe what to show, not how to wire up the
// DOM. ``rows`` is an array of [label, value] tuples; values stay
// as plain strings so the tooltip can never accidentally inject
// HTML from a data field.

export function buildTooltipBody({ title, rows = [], footer }) {
    const frag = document.createDocumentFragment();

    if (title) frag.append(textNode("div", "chart-tooltip__title", title));

    for (const [label, value] of rows) {
        const row = document.createElement("div");
        row.className = "chart-tooltip__kv";
        row.append(
            textNode("span", null, label),
            textNode("strong", null, value),
        );
        frag.append(row);
    }

    if (footer) frag.append(textNode("div", "chart-tooltip__muted", footer));

    return frag;
}

function textNode(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = text;
    return node;
}
