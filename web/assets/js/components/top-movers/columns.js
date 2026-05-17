// Column metadata, table header, and per-column sort affordance.
// The column array is the single source of truth for both <th>
// headers and the per-cell classes consumed by rows.js.

import { SVG_NS } from "../../utils/dom.js";
import { t } from "../../utils/i18n.js";

// labelKey: i18n path resolved at render time so a locale swap
//   repaints headers without rebuilding the array.
// defaultDir: flip direction on first click. Numeric columns
//   land big-first ("desc"); ordinal columns a-first ("asc").
const TABLE_COLUMNS = [
    { labelKey: null, className: "top-movers__rank" },
    {
        labelKey: "topMovers.columns.as",
        className: "top-movers__asn",
        sortable: true,
        field: "asn",
        defaultDir: "asc",
    },
    {
        labelKey: "topMovers.columns.changes",
        className: "top-movers__num",
        sortable: true,
        field: "changes",
        defaultDir: "desc",
    },
    {
        labelKey: "topMovers.columns.touched",
        className: "top-movers__num",
        sortable: true,
        field: "touched",
        defaultDir: "desc",
    },
    { labelKey: "topMovers.columns.shareOfAll", className: "top-movers__num" },
    {
        labelKey: "topMovers.columns.direction",
        className: "top-movers__direction",
        sortable: true,
        field: "direction",
        defaultDir: "asc",
    },
];

export function tableHead(state, onChange) {
    const thead = document.createElement("thead");
    const tr = document.createElement("tr");
    for (const column of TABLE_COLUMNS) {
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
