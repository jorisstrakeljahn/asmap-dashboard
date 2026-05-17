// Column metadata, the table header, and the per-column sort
// affordance.
//
// The column array is the single source of truth for both <th>
// headers and the per-cell classes consumed by rows.js. Headers
// stay text-only for non-sortable columns; sortable columns swap
// their label for a button that exposes the current sort state
// via aria-sort and a chevron mirroring the dropdown chevron.

import { SVG_NS } from "../../utils/dom.js";

// Column definitions. Keeping classNames in the column list lets
// one CSS rule align both the header and its body cells without
// column-index math.
//
// The leading "rank" column carries no header label — a "#" only
// adds chrome when its meaning ("row number on the current page
// in the current sort") is already obvious from the row itself.
// The number resets on every page so it is read as "where am I
// on this page", not "global popularity rank"; that matches how
// other dashboards (Linear, Notion) handle paginated tables.
//
//   field      — sort key understood by compareMovers()
//   defaultDir — direction the column flips to on first click
//                ("desc" for numeric columns so big numbers land
//                on top, "asc" for ordinal ones)
export const TABLE_COLUMNS = [
    { label: "", className: "top-movers__rank" },
    {
        label: "AS",
        className: "top-movers__asn",
        sortable: true,
        field: "asn",
        defaultDir: "asc",
    },
    {
        label: "Changes",
        className: "top-movers__num",
        sortable: true,
        field: "changes",
        defaultDir: "desc",
    },
    {
        label: "Touched",
        className: "top-movers__num",
        sortable: true,
        field: "touched",
        defaultDir: "desc",
    },
    { label: "% of all", className: "top-movers__num" },
    {
        label: "Direction",
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

// Sortable column headers swap their text for a button so screen
// readers and keyboard users can trigger the sort with the same
// affordance as a click. aria-sort on the <th> lets assistive
// tech announce the active column and direction.
//
// Visually, only the active column carries a chevron pointing in
// the current sort direction. Cold columns stay text-only — the
// row is already small and the chevron would compete with the
// active column for attention. Sortability is discoverable via
// the pointer cursor on hover and is announced via aria-label.
function headerCell(column, state, onChange) {
    const th = document.createElement("th");
    th.className = column.className;
    if (!column.sortable) {
        th.textContent = column.label;
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
    labelSpan.textContent = column.label;
    button.append(labelSpan);

    if (isActive) button.append(sortChevron(state.sortDir));

    button.setAttribute(
        "aria-label",
        isActive
            ? `Sort by ${column.label}, currently ${
                state.sortDir === "asc" ? "ascending" : "descending"
            }`
            : `Sort by ${column.label}`,
    );
    button.addEventListener("click", () => {
        // Click on the active column flips direction; click on a
        // cold column starts at its declared default so numeric
        // columns land big-first and ordinal ones a-first without
        // requiring a second click.
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

// Same stroke-based chevron as the dropdown trigger (see
// createDropdown in dropdown.js) so the table's sort affordance
// speaks the same visual language as every other dropdown on the
// page. direction "asc" points up; "desc" points down.
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
