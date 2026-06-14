// Top Movers card orchestrator. Builds the scaffold and a single
// persistent <table> once, then splits redraws into a head pass and
// a body pass so a filter keystroke swaps only <tbody> + pagination.
//
// ``mount(parent, diff, { family })`` — the family is driven by
// the Diff Explorer master toggle and decides which currency
// the cells, sort, and share denominator speak. The card reads
// the family from the parent rather than owning its own picker.

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
import { accessorsFor } from "./units.js";

export function mount(parent, diff, { family } = {}) {
    if (!diff || !diff.top_movers.length) {
        parent.replaceChildren(mutedNote(t("topMovers.empty")));
        return;
    }

    const state = createState({ family });
    const card = buildCardScaffold();

    // One <table> for the card's life. The <thead> (sortable header
    // buttons + their listeners) only changes on a unit or sort
    // change; the <tbody> changes on every filter / page move. Keeping
    // them as separate persistent elements means typing never rebuilds
    // the header or rebinds its listeners.
    const table = document.createElement("table");
    table.className = "top-movers__grid";
    const thead = document.createElement("thead");
    const tbody = document.createElement("tbody");
    table.append(thead, tbody);
    card.tableWrap.append(table);

    const filterInput = buildFilterInput(state, () => renderBody());
    const directionControl = buildDirectionFilter(state, () => renderBody());
    card.toolbarFields.append(filterInput.elem, directionControl.elem);

    // The view-mode switch only flips a CSS class on the table, so it
    // skips both passes — no row recompute, no head rebuild.
    card.headerControls.append(
        viewModeSwitch(state, applyNamesClass, saveShowNames),
    );
    // Pin the info trigger to the card's top-right corner (like the
    // overview cards) instead of trailing the view-mode switch. On a
    // phone the header wraps and a switch-trailing icon drifted onto
    // a second row, detached from the title; the corner anchor keeps
    // it locked to the top edge at every width.
    const info = cardInfoTooltip();
    info.classList.add("info-tooltip--card-corner");
    card.root.append(info);
    card.footer.append(
        pageSizeControl(state, () => renderBody()),
        card.pagination,
    );

    parent.replaceChildren(card.root);

    // A sort click mutates state then asks for a refresh: the header
    // moves its active column / chevron / aria-sort (head) and the
    // rows reorder (body), so it is the one path that runs both.
    function onSort() {
        renderHead();
        renderBody();
    }

    function renderHead() {
        thead.replaceChildren(...tableHead(state, onSort).childNodes);
    }

    function applyNamesClass() {
        table.classList.toggle("top-movers__grid--no-names", !state.showNames);
    }

    function renderBody() {
        const active = pruneInactive(diff.top_movers, state.unit);
        const filtered = filterMovers(
            active,
            state.filterText,
            state.filterDirection,
            state.unit,
        );
        clampPageIndex(state, filtered.length);
        tbody.replaceChildren(...bodyRows(filtered, diff, state));
        card.pagination.replaceChildren(
            ...renderPagination(filtered, state, renderBody),
        );
        renderClearButton(card.clearSlot, isFiltering(state), () => {
            state.filterText = "";
            state.filterDirection = "all";
            state.pageIndex = 0;
            filterInput.setValue("");
            directionControl.setValue("all");
            renderBody();
        });
    }

    renderHead();
    applyNamesClass();
    renderBody();
}

// Drop rows the active currency has nothing to say about. The
// backend top_movers set is a union of the top-N rankings under
// each currency, so a row that ranked in IPv6 but never moved
// IPv4 arrives with zero IPv4 activity. Showing it under the
// IPv4 picker means a long tail of em-dash directions and zero
// shares, which obscures the real story. The union itself ships
// in the lazy-loaded diffs.json; this is the per-currency view
// filter.
function pruneInactive(rows, unit) {
    const rowChanges = accessorsFor(unit).rowChanges;
    return rows.filter((row) => rowChanges(row) > 0);
}

// The <tr> set for the current page, dropped straight into the
// persistent <tbody>. When the filter matches nothing it returns a
// single full-width empty-state row instead, so the <thead> stays put
// across an into / out-of empty transition (no head rebuild) and the
// table markup stays valid (no <tbody>-less note floating in the
// wrap, as the old single-element render produced).
function bodyRows(filteredMovers, diff, state) {
    if (!filteredMovers.length) {
        return [emptyRow()];
    }
    const sorted = sortMovers(
        filteredMovers,
        state.sortField,
        state.sortDir,
        state.unit,
    );
    const start = state.pageIndex * state.pageSize;
    const rows = sorted.slice(start, start + state.pageSize);
    const unitTotal = accessorsFor(state.unit).diffTotal(diff);
    return [...tableBody(rows, unitTotal, start, state.unit).childNodes];
}

// The grid has four columns (rank, AS, share, direction); the
// empty-state note spans all of them.
const COLUMN_COUNT = 4;

function emptyRow() {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.className = "top-movers__empty";
    td.colSpan = COLUMN_COUNT;
    td.append(mutedNote(t("topMovers.noMatches")));
    tr.append(td);
    return tr;
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
