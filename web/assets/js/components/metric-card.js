// Shared metric-card primitives for the overview heroes on the Maps
// tab (overview-cards.js) and Network tab (network/overview.js): a
// card with a corner info tooltip, uppercase label, metric number,
// unit line, and delta lines. Keeps the two heroes identical.

import { html, nothing, render } from "../vendor/lit-html.js";
import { glueUnits } from "../format.js";
import { cloneSheetContext, createInfoTooltip } from "./info-tooltip.js";

// `body` is the card's content as a template. The card stays a real element so
// its info tooltip can clone the content for the mobile sheet; lit fills the
// children. `badge` is an optional template after the label (Maps uses it for
// the "filled fallback" marker; Network passes none).
export function createCard(label, body, { info, infoAria, badge } = {}) {
    const card = document.createElement("article");
    card.className = "card";

    let tip = nothing;
    if (info) {
        const tooltip = createInfoTooltip({
            body: info,
            ariaLabel: infoAria,
            // Mobile sheet leads with a clone of this card's content so the
            // reader keeps the context the desktop popover gets from sitting
            // next to the card.
            sheetHeader: () => cloneSheetContext(card),
        });
        tooltip.classList.add("info-tooltip--card-corner");
        tip = tooltip;
    }

    render(
        html`
            ${tip}
            <span class="card__label uppercase-label">${label.toUpperCase()}</span>
            ${badge ?? nothing}
            ${body}
        `,
        card,
    );
    return card;
}

export const metricNumber = (text) => html`<p class="card__metric">${text}</p>`;

export const metricUnit = (text) => html`<p class="card__unit">${text}</p>`;

// Glue numbers to their units so a narrow card never orphans a word
// ("0\nunmapped") on its own line.
export const deltaLine = (text) =>
    html`<p class="card__delta">${glueUnits(text)}</p>`;

// "vs previous" / "vs <date>" line, pinned to the card's bottom (.card__meta)
// so it aligns across a row of cards. Use it for the comparison/date line, not
// figures that belong with the description.
export const metaLine = (text) =>
    html`<p class="card__meta">${glueUnits(text)}</p>`;
