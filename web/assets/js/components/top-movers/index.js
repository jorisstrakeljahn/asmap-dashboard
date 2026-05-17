// Top Movers card orchestrator. Mounts the card scaffold (header,
// toolbar, table region, footer) once, then re-renders the table
// body and pagination on every state change through render().
//
// The card is a paginated list of the AS numbers most affected by
// the selected diff, with a Compact / Detailed view switch, a
// page-size dropdown, and a direction column summarising which
// counterpart prefixes flowed to or from. The view-mode
// preference is persisted across visits via localStorage.
//
// Submodules:
//   state.js       — defaults, persisted flags, mutable state shape
//   sort.js        — comparator + derived "Touched" / direction rank
//   filter.js      — substring + direction filter predicates
//   pagination.js  — page-window picker + page-button rendering
//   columns.js     — column metadata + table header + sort chevron
//   rows.js        — per-row tbody builder (cells, direction glyph)
//   controls.js    — toolbar / footer controls + TOP_MOVERS_INFO copy

import { mutedNote } from "../../utils/dom.js";
import { tableHead } from "./columns.js";
import {
    buildDirectionFilter,
    buildFilterInput,
    cardInfoTooltip,
    pageSizeControl,
    renderClearButton,
    viewModeSwitch,
} from "./controls.js";
import { filterMovers } from "./filter.js";
import { clampPageIndex, renderPagination } from "./pagination.js";
import { tableBody } from "./rows.js";
import { sortMovers } from "./sort.js";
import { createState, isFiltering, saveShowNames } from "./state.js";

export function mount(parent, diff) {
    if (!diff || !diff.top_movers.length) {
        parent.replaceChildren(mutedNote("No top movers in the selected diff."));
        return;
    }

    const state = createState();
    const card = buildCardScaffold();

    // The toolbar controls own a ``setValue`` hook so the Clear
    // pill can reset them without each builder needing its own
    // ref-passing dance.
    const filterInput = buildFilterInput(state, () => render());
    const directionControl = buildDirectionFilter(state, () => render());
    card.toolbarFields.append(filterInput.elem, directionControl.elem);

    card.headerControls.append(
        viewModeSwitch(state, () => render(), saveShowNames),
        cardInfoTooltip(),
    );
    card.footer.append(
        pageSizeControl(state, () => render()),
        card.pagination,
    );

    parent.replaceChildren(card.root);

    function render() {
        const filtered = filterMovers(
            diff.top_movers,
            state.filterText,
            state.filterDirection,
        );
        clampPageIndex(state, filtered.length);
        card.tableWrap.replaceChildren(renderTable(filtered, diff, state, render));
        card.pagination.replaceChildren(
            ...renderPagination(filtered, state, render),
        );
        renderClearButton(card.clearSlot, isFiltering(state), () => {
            state.filterText = "";
            state.filterDirection = "all";
            state.pageIndex = 0;
            filterInput.setValue("");
            directionControl.setValue("all");
            render();
        });
    }
    render();
}

function renderTable(filteredMovers, diff, state, onChange) {
    if (!filteredMovers.length) {
        return mutedNote("No autonomous systems match this filter.");
    }
    const sorted = sortMovers(filteredMovers, state.sortField, state.sortDir);
    const start = state.pageIndex * state.pageSize;
    const rows = sorted.slice(start, start + state.pageSize);

    const table = document.createElement("table");
    table.className = "top-movers__grid";
    if (!state.showNames) table.classList.add("top-movers__grid--no-names");
    table.append(
        tableHead(state, onChange),
        tableBody(rows, diff.total_changes, start),
    );
    return table;
}

// Assemble the static DOM regions the orchestrator fills on
// every render: header (identity + view mode + info tooltip),
// toolbar (filter facets + Clear pill slot), table region, and
// footer (page size + pagination). Returns named refs to each
// region so the orchestrator can wire the controls without
// re-querying the DOM.
function buildCardScaffold() {
    const root = document.createElement("article");
    root.className = "card top-movers";

    const header = document.createElement("header");
    header.className = "top-movers__header";
    const title = document.createElement("span");
    title.className = "card__label uppercase-label";
    title.textContent = "Top Movers";
    const headerControls = document.createElement("div");
    headerControls.className = "top-movers__header-controls";
    header.append(title, headerControls);

    const toolbar = document.createElement("div");
    toolbar.className = "top-movers__toolbar";
    const toolbarFields = document.createElement("div");
    toolbarFields.className = "top-movers__toolbar-fields";
    const clearSlot = document.createElement("div");
    clearSlot.className = "top-movers__clear-slot";
    clearSlot.setAttribute("aria-live", "polite");
    toolbar.append(toolbarFields, clearSlot);

    const tableWrap = document.createElement("div");
    tableWrap.className = "top-movers__table";

    const footer = document.createElement("footer");
    footer.className = "top-movers__footer";

    const pagination = document.createElement("nav");
    pagination.className = "top-movers__pagination";
    pagination.setAttribute("aria-label", "Top movers pagination");

    root.append(header, toolbar, tableWrap, footer);

    return {
        root,
        headerControls,
        toolbarFields,
        clearSlot,
        tableWrap,
        footer,
        pagination,
    };
}
