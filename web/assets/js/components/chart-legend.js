// Chart legend, in two flavours from one API. Charts that show a
// fixed set of series pass plain entries and get a static legend.
// Charts that want viewers to focus on a subset pass an onToggle
// callback and get a clickable legend whose buttons hide their
// matching SVG series.
//
// The DOM stays stable across toggles. Buttons flip a single
// --off modifier the chart's CSS reads to dim the swatch and
// strike the label, while the chart itself re-renders so its
// y axis can rescale to whatever stays on. Hidden series stay in
// hover tooltips because the data point still exists.
//
// Entry shape:
//   { key: string, label: string, swatchClass: string }
//
// ``key`` matches whatever the chart stores in its hidden Set.
// ``swatchClass`` is the modifier that gives the colour swatch
// its colour (e.g. "chart-legend__swatch--filled").

// Public: build the legend node. Returns a div with one item per
// entry. When ``onToggle`` is provided every item is a button
// that calls ``onToggle(key)`` on click and reflects the matching
// hidden state via aria-pressed and the --off modifier.
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
    item.setAttribute("aria-label", `Toggle ${entry.label}`);
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
