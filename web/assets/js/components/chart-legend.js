// Chart legend. Pass ``onToggle`` for a clickable legend whose
// buttons hide / show series; omit it for a static legend.
// Entry shape: { key, label, swatchClass }.

import { t } from "../utils/i18n.js";

export function createChartLegend({ entries, hidden, onToggle }) {
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
    return legend;
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
