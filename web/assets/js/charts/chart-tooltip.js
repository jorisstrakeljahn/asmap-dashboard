// Declarative builder for a chart tooltip's contents so each chart
// describes what to show, not how to wire the DOM. ``rows`` is an
// array of [label, value, swatchClass?] tuples; label and value stay
// plain strings so the tooltip can never inject HTML from a data
// field. The optional swatchClass renders a small colour dot before
// the label, used where the tooltip is the only place a colour gets
// named (the operator breakdown has no static legend).

export function buildTooltipBody({ title, rows = [], footer }) {
    const frag = document.createDocumentFragment();

    if (title) frag.append(textNode("div", "chart-tooltip__title", title));

    for (const [label, value, swatchClass] of rows) {
        const row = document.createElement("div");
        row.className = "chart-tooltip__kv";
        const labelNode = textNode("span", null, label);
        if (swatchClass) {
            labelNode.prepend(
                textNode("span", `chart-tooltip__swatch ${swatchClass}`, ""),
            );
        }
        row.append(labelNode, textNode("strong", null, value));
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
