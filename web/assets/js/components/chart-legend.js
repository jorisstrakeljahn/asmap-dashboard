// Chart legend. Pass `onToggle` for clickable buttons that hide/show series;
// omit it for a static legend. Entry: { key, label, swatchClass }. `unavailable`
// entries ({ ...entry, title }) render greyed and non-interactive after the
// live ones, so a crawler with no data in this view stays listed with a reason
// on hover instead of vanishing.

import { html, nothing } from "../vendor/lit-html.js";
import { renderToElement } from "../utils/dom.js";
import { t } from "../utils/i18n.js";

export function createChartLegend({ entries, hidden, onToggle, unavailable = [] }) {
    const off = hidden ?? new Set();
    return renderToElement(html`
        <div class="chart-legend">
            ${entries.map((entry) =>
                onToggle ? toggleableItem(entry, off, onToggle) : staticItem(entry),
            )}
            ${unavailable.map(unavailableItem)}
        </div>
    `);
}

const swatch = (entry) => html`<span
    class="chart-legend__swatch ${entry.swatchClass}"
    aria-hidden="true"
></span>`;

function staticItem(entry) {
    return html`<span class="chart-legend__item"
        >${swatch(entry)}<span>${entry.label}</span></span
    >`;
}

// A greyed, non-clickable entry for a series with no data in this view.
// Reuses the ``--off`` dimming the toggle uses for a hidden line; the
// title surfaces why it carries no line.
function unavailableItem(entry) {
    return html`<span
        class="chart-legend__item chart-legend__item--off"
        title=${entry.title ?? nothing}
        >${swatch(entry)}<span>${entry.label}</span></span
    >`;
}

function toggleableItem(entry, hidden, onToggle) {
    const isOff = hidden.has(entry.key);
    return html`<button
        type="button"
        class="chart-legend__item ${isOff ? "chart-legend__item--off" : ""}"
        aria-pressed=${String(!isOff)}
        aria-label=${t("chartLegend.toggleAria", { label: entry.label })}
        @click=${(event) => {
            // The legend renders once and is never lit-re-rendered (only the
            // plot redraws on toggle), so this button is the single writer of
            // its own --off/aria-pressed state. If the legend ever becomes
            // lit-re-rendered, move this state into the template instead, or
            // the two writers will fight.
            const nowOff = event.currentTarget.classList.toggle(
                "chart-legend__item--off",
            );
            event.currentTarget.setAttribute("aria-pressed", String(!nowOff));
            onToggle(entry.key);
        }}
        >${swatch(entry)}<span>${entry.label}</span></button
    >`;
}
