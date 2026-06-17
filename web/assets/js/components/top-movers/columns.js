// Column metadata, table header, and per-column sort affordance.
// The column array is the single source of truth for both <th>
// headers and the per-cell classes consumed by rows.js.

import { SVG_NS } from "../../utils/dom.js";
import { t } from "../../utils/i18n.js";
import { accessorsFor } from "./units.js";

// labelKey resolves at render time so a locale swap repaints
// headers without a rebuild; Share reads its key off the accessor
// bundle so it renames with the currency picker. defaultDir sets
// first-click direction: numeric desc, ordinal asc.
function tableColumns(unit) {
    const accessors = accessorsFor(unit);
    return [
        { labelKey: null, className: "top-movers__rank" },
        {
            labelKey: "topMovers.columns.as",
            className: "top-movers__asn",
            sortable: true,
            field: "asn",
            defaultDir: "asc",
        },
        {
            labelKey: accessors.shareDenominatorKey,
            // The currency-specific header ("% of all IPv4") is too
            // long for the single-line mobile sort bar, so the
            // stacked card view swaps in this short label via CSS.
            shortLabelKey: "topMovers.columns.share",
            className: "top-movers__num",
            sortable: true,
            field: "share",
            defaultDir: "desc",
        },
        {
            labelKey: "topMovers.columns.direction",
            className: "top-movers__direction",
            sortable: true,
            field: "direction",
            defaultDir: "asc",
        },
    ];
}

export function tableHead(state, onChange) {
    const thead = document.createElement("thead");
    const tr = document.createElement("tr");
    for (const column of tableColumns(state.unit)) {
        tr.append(headerCell(column, state, onChange));
    }
    thead.append(tr);
    return thead;
}

// Sortable headers render a button so keyboard users get the
// same affordance as click. Only the active column carries the
// chevron; cold columns stay text-only.
function headerCell(column, state, onChange) {
    const th = document.createElement("th");
    th.className = column.className;
    const label = column.labelKey ? t(column.labelKey) : "";
    if (!column.sortable) {
        th.textContent = label;
        return th;
    }

    const isActive = state.sortField === column.field;
    const dir = isActive ? state.sortDir : null;
    th.setAttribute(
        "aria-sort",
        dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none",
    );

    const button = document.createElement("button");
    button.type = "button";
    button.className = "top-movers__sort-button";
    if (isActive) button.classList.add("is-active");

    const labelSpan = document.createElement("span");
    labelSpan.className = "top-movers__sort-label";
    labelSpan.textContent = label;
    button.append(labelSpan);

    // Short label rides as a second span; CSS (--full / --short)
    // toggles which one shows, so no width branch in JS.
    if (column.shortLabelKey) {
        labelSpan.classList.add("top-movers__sort-label--full");
        const shortSpan = document.createElement("span");
        shortSpan.className =
            "top-movers__sort-label top-movers__sort-label--short";
        shortSpan.textContent = t(column.shortLabelKey);
        shortSpan.setAttribute("aria-hidden", "true");
        button.append(shortSpan);
    }

    if (isActive) button.append(sortChevron(state.sortDir));

    button.setAttribute(
        "aria-label",
        isActive
            ? t("topMovers.sort.activeAria", {
                column: label,
                direction: t(
                    state.sortDir === "asc"
                        ? "topMovers.sort.ascending"
                        : "topMovers.sort.descending",
                ),
            })
            : t("topMovers.sort.inactiveAria", { column: label }),
    );
    button.addEventListener("click", () => {
        if (isActive) {
            state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
        } else {
            state.sortField = column.field;
            state.sortDir = column.defaultDir;
        }
        state.pageIndex = 0;
        onChange();
    });

    th.append(button);
    return th;
}

function sortChevron(direction) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "top-movers__sort-chevron");
    svg.setAttribute("viewBox", "0 0 12 12");
    svg.setAttribute("width", "10");
    svg.setAttribute("height", "10");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute(
        "d",
        direction === "asc" ? "M3 7.5L6 4.5L9 7.5" : "M3 4.5L6 7.5L9 4.5",
    );
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.5");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.append(path);
    return svg;
}
