import { formatNumber, formatPercent } from "../format.js";

const PAGE_SIZES = [10, 25, 50];
const DEFAULT_PAGE_SIZE = 10;

export function mount(parent, diff) {
    if (!diff || !diff.top_movers.length) {
        parent.replaceChildren(emptyState());
        return;
    }

    const state = { pageSize: DEFAULT_PAGE_SIZE, pageIndex: 0 };
    const card = document.createElement("article");
    card.className = "card top-movers";

    const header = document.createElement("header");
    header.className = "top-movers__header";
    const title = document.createElement("span");
    title.className = "card__label uppercase-label";
    title.textContent = "Top Movers";
    header.append(title, pageSizeControl(state, () => render()));

    const tableWrap = document.createElement("div");
    tableWrap.className = "top-movers__table";

    const pagination = document.createElement("nav");
    pagination.className = "top-movers__pagination";

    card.append(header, tableWrap, pagination);
    parent.replaceChildren(card);

    function render() {
        tableWrap.replaceChildren(renderTable(diff, state));
        pagination.replaceChildren(...renderPagination(diff, state, render));
    }
    render();
}

function renderTable(diff, state) {
    const start = state.pageIndex * state.pageSize;
    const rows = diff.top_movers.slice(start, start + state.pageSize);

    const table = document.createElement("table");
    table.className = "top-movers__grid";
    table.append(tableHead(), tableBody(rows, diff.total_changes, start));
    return table;
}

function tableHead() {
    const thead = document.createElement("thead");
    const tr = document.createElement("tr");
    for (const label of ["#", "AS", "Changes", "% of all", "Direction"]) {
        const th = document.createElement("th");
        th.textContent = label;
        tr.append(th);
    }
    thead.append(tr);
    return thead;
}

function tableBody(rows, totalChanges, startIndex) {
    const tbody = document.createElement("tbody");
    rows.forEach((row, i) => {
        const tr = document.createElement("tr");
        const cells = [
            startIndex + i + 1,
            `AS${row.asn}`,
            formatNumber(row.changes),
            formatPercent(row.changes / Math.max(totalChanges, 1), 1),
            formatDirection(row),
        ];
        cells.forEach((value, idx) => {
            const td = document.createElement("td");
            td.textContent = value;
            if (idx === 0) td.classList.add("top-movers__rank");
            tr.append(td);
        });
        tbody.append(tr);
    });
    return tbody;
}

// Picks the most informative arrow given gained / lost counts.
// Falls back to the older primary_counterpart-only schema when the
// row was produced by an older metrics.json (no gained/lost keys).
function formatDirection(row) {
    const counterpart = row.primary_counterpart;
    const gained = row.gained;
    const lost = row.lost;

    if (gained === undefined && lost === undefined) {
        if (counterpart === 0 || counterpart === undefined) return "\u2192 unmapped";
        return `\u2194 AS${counterpart}`;
    }

    const counterpartLabel = counterpart === 0 ? "unmapped" : `AS${counterpart}`;
    if (gained > 0 && lost > 0) return `\u2194 AS${counterpart}`;
    if (gained > 0) return `+ from ${counterpartLabel}`;
    if (lost > 0) return `\u2212 to ${counterpartLabel}`;
    return "";
}

function pageSizeControl(state, onChange) {
    const wrap = document.createElement("label");
    wrap.className = "top-movers__page-size";
    const text = document.createElement("span");
    text.className = "muted";
    text.textContent = "Page size";
    const select = document.createElement("select");
    for (const size of PAGE_SIZES) {
        const option = document.createElement("option");
        option.value = String(size);
        option.textContent = String(size);
        if (size === state.pageSize) option.selected = true;
        select.append(option);
    }
    select.addEventListener("change", () => {
        state.pageSize = Number(select.value);
        state.pageIndex = 0;
        onChange();
    });
    wrap.append(text, select);
    return wrap;
}

function renderPagination(diff, state, onChange) {
    const totalPages = Math.ceil(diff.top_movers.length / state.pageSize);
    if (totalPages <= 1) return [];

    const buttons = [];
    for (let i = 0; i < totalPages; i++) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "top-movers__page";
        if (i === state.pageIndex) button.classList.add("is-active");
        button.textContent = String(i + 1);
        button.addEventListener("click", () => {
            state.pageIndex = i;
            onChange();
        });
        buttons.push(button);
    }
    return buttons;
}

function emptyState() {
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = "No top movers in the selected diff.";
    return note;
}
