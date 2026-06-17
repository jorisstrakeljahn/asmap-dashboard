// Shared metric-card primitives for the overview heroes on the Maps
// tab (overview-cards.js) and Network tab (network/overview.js): a
// card with a corner info tooltip, uppercase label, metric number,
// unit line, and delta lines. Keeps the two heroes identical.

import { glueUnits } from "../format.js";
import { createInfoTooltip } from "./info-tooltip.js";

// ``badge`` is an optional element appended after the label. The Maps
// tab uses it for the "filled fallback" marker; the Network tab passes
// none.
export function createCard(label, { info, infoAria, badge } = {}) {
    const card = document.createElement("article");
    card.className = "card";
    if (info) {
        const tip = createInfoTooltip({ body: info, ariaLabel: infoAria });
        tip.classList.add("info-tooltip--card-corner");
        card.append(tip);
    }
    const title = document.createElement("span");
    title.className = "card__label uppercase-label";
    title.textContent = label.toUpperCase();
    card.append(title);
    if (badge) card.append(badge);
    return card;
}

export function metricNumber(text) {
    const node = document.createElement("p");
    node.className = "card__metric";
    node.textContent = text;
    return node;
}

export function metricUnit(text) {
    const node = document.createElement("p");
    node.className = "card__unit";
    node.textContent = text;
    return node;
}

export function deltaLine(text) {
    const node = document.createElement("p");
    node.className = "card__delta";
    // Glue numbers to their units so a narrow card never orphans a
    // word ("0\nunmapped") on its own line.
    node.textContent = glueUnits(text);
    return node;
}
