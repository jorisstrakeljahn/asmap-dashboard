// Top Movers card orchestrator. Builds the scaffold and one persistent <table>,
// then splits redraws into a head pass and a body pass so a filter keystroke
// swaps only <tbody> + pagination. mount(parent, diff, { family }): family
// comes from the Diff Explorer master toggle and picks the currency the cells,
// sort and share denominator speak; the card owns no picker of its own.

import { html, render } from "../../vendor/lit-html.js";
import { mutedNote, renderToElement } from "../../utils/dom.js";
import { t } from "../../utils/i18n.js";
import { renderTableHead } from "./columns.js";
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
import { renderEmptyBody, renderTableBody } from "./rows.js";
import { sortMovers } from "./sort.js";
import { createState, isFiltering, saveShowNames } from "./state.js";
import { accessorsFor } from "./units.js";

export function mount(parent, diff, { family } = {}) {
    if (!diff || !diff.top_movers.length) {
        render(mutedNote(t("topMovers.empty")), parent);
        return;
    }

    const state = createState({ family });
    const card = buildCardScaffold();

    // One <table> for the card's life. <thead> changes only on a unit/sort
    // change, <tbody> on every filter/page move; keeping them separate means
    // typing never rebuilds the header or rebinds its listeners.
    const table = renderToElement(
        html`<table class="top-movers__grid"><thead></thead><tbody></tbody></table>`,
    );
    const thead = table.querySelector("thead");
    const tbody = table.querySelector("tbody");
    card.tableWrap.append(table);

    const filterInput = buildFilterInput(state, () => renderBody());
    const directionControl = buildDirectionFilter(state, () => renderBody());
    card.toolbarFields.append(filterInput.elem, directionControl.elem);

    // The view-mode switch only flips a CSS class on the table, so it
    // skips both passes - no row recompute, no head rebuild.
    card.headerControls.append(
        viewModeSwitch(state, applyNamesClass, saveShowNames),
    );
    // Info trigger pinned to the card's top-right corner, not trailing the
    // view-mode switch: on a phone the header wraps and a trailing icon drifted
    // onto a second row, detached from the title. The card has no single metric
    // to clone, so the mobile sheet leads with just the "Top Movers" title.
    const info = cardInfoTooltip(() => [card.title.cloneNode(true)]);
    info.classList.add("info-tooltip--card-corner");
    card.root.append(info);
    card.footer.append(
        pageSizeControl(state, () => renderBody()),
        card.pagination,
    );

    render(card.root, parent);

    // A sort click mutates state then refreshes: the header moves its active
    // column/chevron/aria-sort (head) and the rows reorder (body) - the one
    // path that runs both.
    function onSort() {
        renderHead();
        renderBody();
    }

    function renderHead() {
        renderTableHead(thead, state, onSort);
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
        paintBody(tbody, filtered, diff, state);
        render(
            html`${renderPagination(filtered, state, renderBody)}`,
            card.pagination,
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

// Drop rows the active currency has nothing to say about. The backend
// top_movers set is a union of the per-currency top-N rankings, so a row that
// ranked in IPv6 but never moved IPv4 arrives with zero IPv4 activity; under
// the IPv4 picker that's a tail of em-dashes. The per-currency view filter.
function pruneInactive(rows, unit) {
    const rowChanges = accessorsFor(unit).rowChanges;
    return rows.filter((row) => rowChanges(row) > 0);
}

// Paint the current page into the persistent <tbody> via lit (rows.js is the
// single writer of that node). No matches -> one full-width empty-state row, so
// the <thead> stays put and the markup stays valid.
function paintBody(tbody, filteredMovers, diff, state) {
    if (!filteredMovers.length) {
        renderEmptyBody(tbody);
        return;
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
    renderTableBody(tbody, rows, unitTotal, start, state.unit);
}

function buildCardScaffold() {
    const root = renderToElement(html`
        <article class="card top-movers">
            <header class="top-movers__header">
                <span class="card__label uppercase-label"
                    >${t("topMovers.title")}</span
                >
                <div class="top-movers__header-controls"></div>
            </header>
            <div class="top-movers__toolbar">
                <div class="top-movers__toolbar-fields"></div>
                <div class="top-movers__clear-slot" aria-live="polite"></div>
            </div>
            <div class="top-movers__table"></div>
            <footer class="top-movers__footer"></footer>
        </article>
    `);

    // The pagination <nav> lives in the footer but is rebuilt on every page
    // move, so it's its own node handed back for the body pass to render into.
    const pagination = document.createElement("nav");
    pagination.className = "top-movers__pagination";
    pagination.setAttribute("aria-label", t("topMovers.pagination.navAria"));

    return {
        root,
        title: root.querySelector(".card__label"),
        headerControls: root.querySelector(".top-movers__header-controls"),
        toolbarFields: root.querySelector(".top-movers__toolbar-fields"),
        clearSlot: root.querySelector(".top-movers__clear-slot"),
        tableWrap: root.querySelector(".top-movers__table"),
        footer: root.querySelector(".top-movers__footer"),
        pagination,
    };
}
