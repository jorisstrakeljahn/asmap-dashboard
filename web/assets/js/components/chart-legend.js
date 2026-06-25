// Chart legend. Pass ``onToggle`` for a clickable legend whose
// buttons hide / show series; omit it for a static legend.
// Entry shape: { key, label, swatchClass }.
//
// ``unavailable`` entries ({ ...entry, title }) render greyed and
// non-interactive after the live ones: a crawler that has no data in
// the current view (e.g. no whois for the reality anchor) stays listed
// with a reason on hover instead of silently disappearing.

import { t } from "../utils/i18n.js";

export function createChartLegend({ entries, hidden, onToggle, unavailable = [] }) {
    const legend = document.createElement("div");
    legend.className = "chart-legend";
    const off = hidden ?? new Set();
    for (const entry of entries) {
        legend.append(
            onToggle
                ? toggleableItem(entry, off, onToggle)
                : staticItem(entry),
        );
    }
    for (const entry of unavailable) {
        legend.append(unavailableItem(entry));
    }
    return legend;
}

// A greyed, non-clickable entry for a series with no data in this view.
// Reuses the ``--off`` dimming the toggle uses for a hidden line; the
// title surfaces why it carries no line.
function unavailableItem(entry) {
    const item = document.createElement("span");
    item.className = "chart-legend__item chart-legend__item--off";
    if (entry.title) item.title = entry.title;
    item.append(swatchNode(entry), labelNode(entry));
    return item;
}

function staticItem(entry) {
    const item = document.createElement("span");
    item.className = "chart-legend__item";
    item.append(swatchNode(entry), labelNode(entry));
    return item;
}

function toggleableItem(entry, hidden, onToggle) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "chart-legend__item";
    if (hidden.has(entry.key)) item.classList.add("chart-legend__item--off");
    item.setAttribute("aria-pressed", String(!hidden.has(entry.key)));
    item.setAttribute(
        "aria-label",
        t("chartLegend.toggleAria", { label: entry.label }),
    );
    item.append(swatchNode(entry), labelNode(entry));
    item.addEventListener("click", () => {
        const isOff = item.classList.toggle("chart-legend__item--off");
        item.setAttribute("aria-pressed", String(!isOff));
        onToggle(entry.key);
    });
    return item;
}

function swatchNode(entry) {
    const swatch = document.createElement("span");
    swatch.className = `chart-legend__swatch ${entry.swatchClass}`;
    swatch.setAttribute("aria-hidden", "true");
    return swatch;
}

function labelNode(entry) {
    const label = document.createElement("span");
    label.textContent = entry.label;
    return label;
}
