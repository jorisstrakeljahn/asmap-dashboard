// Top Movers card orchestrator. Builds the scaffold once and
// re-runs render() on every state change.

import { mutedNote } from "../../utils/dom.js";
import { t } from "../../utils/i18n.js";
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
        parent.replaceChildren(mutedNote(t("topMovers.empty")));
        return;
    }

    const state = createState();
    const card = buildCardScaffold();

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
        return mutedNote(t("topMovers.noMatches"));
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

function buildCardScaffold() {
    const root = document.createElement("article");
    root.className = "card top-movers";

    const header = document.createElement("header");
    header.className = "top-movers__header";
    const title = document.createElement("span");
    title.className = "card__label uppercase-label";
    title.textContent = t("topMovers.title");
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
    pagination.setAttribute("aria-label", t("topMovers.pagination.navAria"));

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
