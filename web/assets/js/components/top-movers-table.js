import { formatNumber, formatPercent } from "../format.js";
import { asnCell } from "../asn-names.js";
import { uniqueId } from "../utils/dom.js";
import { createDropdown } from "./dropdown.js";

const PAGE_SIZES = [10, 25, 50];
const DEFAULT_PAGE_SIZE = 10;
const SHOW_NAMES_KEY = "asmap.topMovers.showNames";

// Column definitions are the single source of truth for both
// <th> headers and the per-cell classes. Headers stay text-only;
// the body is rendered cell-by-cell so each column can carry its
// own DOM (asnCell, arrow + counterpart, ...). Keeping classNames
// in the column list lets one CSS rule align both the header and
// its body cells without column-index math.
const TABLE_COLUMNS = [
    { label: "#", className: "top-movers__rank" },
    { label: "AS", className: "top-movers__asn" },
    { label: "Changes", className: "top-movers__num" },
    { label: "% of all", className: "top-movers__num" },
    { label: "Direction", className: "top-movers__direction" },
];

// Arrow glyphs used to summarise the relationship between a
// top-mover ASN and its primary counterpart. Same Unicode arrow
// family so they share an optical baseline in the table.
const ARROW = {
    UNMAPPED: "\u2192", // ASN moved to "no ASN"; column reads "→ unmapped"
    EXCHANGE: "\u2194", // prefixes flowed in both directions
    GAINED: "\u2197",   // this ASN gained prefixes from the counterpart
    LOST: "\u2198",     // this ASN lost prefixes to the counterpart
};

export function mount(parent, diff) {
    if (!diff || !diff.top_movers.length) {
        parent.replaceChildren(emptyState());
        return;
    }

    const state = {
        pageSize: DEFAULT_PAGE_SIZE,
        pageIndex: 0,
        showNames: loadShowNames(),
    };
    const card = document.createElement("article");
    card.className = "card top-movers";

    const header = document.createElement("header");
    header.className = "top-movers__header";
    const title = document.createElement("span");
    title.className = "card__label uppercase-label";
    title.textContent = "Top Movers";

    const controls = document.createElement("div");
    controls.className = "top-movers__controls";
    controls.append(
        showNamesToggle(state, () => render()),
        pageSizeControl(state, () => render()),
    );
    header.append(title, controls);

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
    if (!state.showNames) table.classList.add("top-movers__grid--no-names");
    table.append(tableHead(), tableBody(rows, diff.total_changes, start));
    return table;
}

function tableHead() {
    const thead = document.createElement("thead");
    const tr = document.createElement("tr");
    for (const column of TABLE_COLUMNS) {
        const th = document.createElement("th");
        th.className = column.className;
        th.textContent = column.label;
        tr.append(th);
    }
    thead.append(tr);
    return thead;
}

function tableBody(rows, totalChanges, startIndex) {
    const tbody = document.createElement("tbody");
    rows.forEach((row, i) => {
        const shareOfAll =
            formatPercent(row.changes / Math.max(totalChanges, 1), 1);
        const tr = document.createElement("tr");
        tr.append(
            cell(startIndex + i + 1, "top-movers__rank"),
            cell(asnCell(row.asn), "top-movers__asn"),
            cell(formatNumber(row.changes), "top-movers__num"),
            cell(shareOfAll, "top-movers__num"),
            directionCell(row),
        );
        tbody.append(tr);
    });
    return tbody;
}

// Build a <td>. ``content`` may be a string (set as textContent)
// or a DOM Node (appended). Keeping both paths in one helper
// avoids the cellText / cellNode split that used to live here.
function cell(content, className) {
    const td = document.createElement("td");
    if (className) td.className = className;
    if (content instanceof Node) td.append(content);
    else td.textContent = String(content);
    return td;
}

// Direction collapses (this ASN -> counterpart ASN) into a single
// glyph plus the counterpart label. The "from"/"to" wording lives
// only in the tooltip so the row stays narrow and visually
// balanced. Older metrics.json payloads without gained/lost still
// render via the bidirectional fallback.
//
// The flex layout sits on an inner <span>, not on the <td> itself,
// so the table layout engine still measures the cell as a regular
// table-cell and distributes column widths correctly.
function directionCell(row) {
    const td = cell("", "top-movers__direction");

    const counterpart = row.primary_counterpart;
    if (!counterpart) {
        td.textContent = `${ARROW.UNMAPPED} unmapped`;
        return td;
    }

    const flow = describeFlow(row, counterpart);
    if (!flow) return td;

    const inner = document.createElement("span");
    inner.className = "top-movers__direction-inner";
    inner.append(arrowGlyph(flow.arrow, flow.tooltip), asnCell(counterpart));
    td.append(inner);
    return td;
}

// Pick the arrow glyph + tooltip for a top-mover row relative to
// its counterpart. Returns null when the row is a no-op (no
// prefixes flowed in either direction). Pure so it can be tested
// in isolation without DOM dependencies.
function describeFlow(row, counterpart) {
    const { gained, lost } = row;
    const hasFlowData = gained !== undefined || lost !== undefined;

    if (!hasFlowData || (gained > 0 && lost > 0)) {
        return {
            arrow: ARROW.EXCHANGE,
            tooltip: `exchanged prefixes with AS${counterpart}`,
        };
    }
    if (gained > 0) {
        return {
            arrow: ARROW.GAINED,
            tooltip: `gained prefixes from AS${counterpart}`,
        };
    }
    if (lost > 0) {
        return {
            arrow: ARROW.LOST,
            tooltip: `lost prefixes to AS${counterpart}`,
        };
    }
    return null;
}

function arrowGlyph(glyph, tooltip) {
    const el = document.createElement("span");
    el.className = "top-movers__arrow";
    el.textContent = glyph;
    el.title = tooltip;
    return el;
}

function pageSizeControl(state, onChange) {
    const wrap = document.createElement("div");
    wrap.className = "top-movers__page-size";

    const labelId = uniqueId("top-movers-page-size-label");
    const text = document.createElement("span");
    text.className = "muted";
    text.id = labelId;
    text.textContent = "Page size";

    const dropdown = createDropdown({
        options: PAGE_SIZES.map((size) => ({
            value: String(size),
            label: String(size),
        })),
        value: String(state.pageSize),
        ariaLabelledBy: labelId,
        size: "small",
        onChange: (value) => {
            state.pageSize = Number(value);
            state.pageIndex = 0;
            onChange();
        },
    });

    wrap.append(text, dropdown);
    return wrap;
}

function showNamesToggle(state, onChange) {
    const wrap = document.createElement("label");
    wrap.className = "top-movers__toggle";

    const text = document.createElement("span");
    text.className = "muted";
    text.textContent = "Operator names";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = state.showNames;
    input.addEventListener("change", () => {
        state.showNames = input.checked;
        saveShowNames(state.showNames);
        onChange();
    });

    // Label first, control second - mirrors the Page size field next
    // to it so the header reads as one consistent "label: control"
    // group from left to right.
    wrap.append(text, input);
    return wrap;
}

// Persist the toggle across visits. Storage may be unavailable in
// Safari private mode or when the user disables cookies/storage; both
// reads and writes fall back to "names on" without surfacing an error.
function loadShowNames() {
    try {
        const raw = localStorage.getItem(SHOW_NAMES_KEY);
        return raw === null ? true : raw === "true";
    } catch {
        return true;
    }
}

function saveShowNames(value) {
    try {
        localStorage.setItem(SHOW_NAMES_KEY, String(value));
    } catch {
        /* storage disabled */
    }
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
