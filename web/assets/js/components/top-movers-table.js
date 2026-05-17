// Top Movers table inside the Diff Explorer card: paginated list
// of the AS numbers most affected by a diff, with a Compact /
// Detailed view switch, page-size dropdown, and a direction
// column summarising which counterpart prefixes flowed to or
// from. The view-mode preference is persisted across visits via
// localStorage.

import { formatNumber, formatPercent } from "../format.js";
import { asnCell, nameFor } from "../asn-names.js";
import { mutedNote, uniqueId } from "../utils/dom.js";
import { createDropdown } from "./dropdown.js";
import { createInfoTooltip } from "./info-tooltip.js";
import { createModeSwitch } from "./mode-switch.js";

const PAGE_SIZES = [10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 10;
const SHOW_NAMES_KEY = "asmap.topMovers.showNames";

// Pagination starts to elide page buttons once the matrix gets
// long enough that printing every index hurts the eye more than
// jumping helps. Below the threshold every page is shown; above
// it we keep the first, last, and a small window around the
// active page (see paginationWindow).
const PAGINATION_FULL_THRESHOLD = 7;

const SVG_NS = "http://www.w3.org/2000/svg";

// Column definitions are the single source of truth for both
// <th> headers and the per-cell classes. Headers stay text-only
// for non-sortable columns; sortable columns swap their label
// for a button that exposes the current sort state via aria-sort
// and a chevron mirroring the dropdown chevron. The body is
// rendered cell-by-cell so each column can carry its own DOM
// (asnCell, arrow + counterpart, ...). Keeping classNames in the
// column list lets one CSS rule align both the header and its
// body cells without column-index math.
//
// The leading "rank" column carries no header label — a "#" only
// adds chrome when its meaning ("row number on the current page
// in the current sort") is already obvious from the row itself.
// The number resets on every page so it is read as "where am I
// on this page", not "global popularity rank"; that matches how
// other dashboards (Linear, Notion) handle paginated tables.
//
//   field      – sort key understood by compareMovers
//   defaultDir – direction the column flips to on first click
//                ("desc" for numeric columns so big numbers land
//                on top, "asc" for ordinal ones)
const TABLE_COLUMNS = [
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

// Initial sort: by changes descending, matching the metrics.json
// payload's natural order so the very first render before any
// click is identical to the pre-sort baseline.
const DEFAULT_SORT = { field: "changes", dir: "desc" };

// Direction-filter facet: the rank values agree with
// directionRank() so the same numbers feed both the sort and the
// filter without a second source of truth. "all" disables the
// filter entirely.
const DIRECTION_FILTERS = [
    { value: "all", label: "All flows" },
    { value: "gained", label: "Gained \u2197", rank: 1 },
    { value: "lost", label: "Lost \u2198", rank: 2 },
    { value: "exchanged", label: "Exchanged \u2194", rank: 3 },
    { value: "unmapped", label: "Unmapped \u2192", rank: 4 },
];

// Single tooltip describing every column the table exposes.
// One bullet per column reads as a glossary so the user does
// not have to scan three separate icons in the header strip.
const TOP_MOVERS_INFO = [
    "Autonomous systems most affected by the selected diff, ranked by entry-level change count.",
    {
        lead: "Changes.",
        text: "Number of prefix to ASN entries in the binary trie that name this AS on either side of the diff. Each entry is counted once.",
    },
    {
        lead: "Touched.",
        text: "How much of this AS's presence the diff visited, expressed as a multiple of its prefix count. 0.50\u00d7 means roughly half of its prefixes participated; 1.00\u00d7 means the diff touched as many trie positions as the AS holds in either map. Values above 1.00\u00d7 appear when one build aggregates the AS into a single large block while the other splits the same range into many smaller pieces — the diff then visits many trie positions per leaf, so the ratio is not capped to 100 %.",
    },
    {
        lead: "% of all.",
        text: "This AS's share of the total entry-level changes between the two builds.",
    },
    {
        lead: "Direction.",
        text: "↗ gained from the counterpart, ↘ lost to it, ↔ prefixes moved both ways, → unmapped means the prefixes lost their ASN entirely.",
    },
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
        parent.replaceChildren(mutedNote("No top movers in the selected diff."));
        return;
    }

    const state = {
        pageSize: DEFAULT_PAGE_SIZE,
        pageIndex: 0,
        showNames: loadShowNames(),
        sortField: DEFAULT_SORT.field,
        sortDir: DEFAULT_SORT.dir,
        filterText: "",
        filterDirection: "all",
    };
    const card = document.createElement("article");
    card.className = "card top-movers";

    // ── Header: card identity + view mode + info tooltip. ──────
    // Stays minimal on purpose; filter inputs live one row down
    // and pagination chrome lives in the footer.
    const header = document.createElement("header");
    header.className = "top-movers__header";
    const title = document.createElement("span");
    title.className = "card__label uppercase-label";
    title.textContent = "Top Movers";
    const explainer = createInfoTooltip({
        body: TOP_MOVERS_INFO,
        ariaLabel: "About the top movers table",
    });
    explainer.classList.add("top-movers__info");
    const headerControls = document.createElement("div");
    headerControls.className = "top-movers__header-controls";
    headerControls.append(viewModeSwitch(state, () => render()), explainer);
    header.append(title, headerControls);

    // ── Toolbar: filter facets on the left; clear pill on the
    // right (visible only while a filter narrows the result set).
    const toolbar = document.createElement("div");
    toolbar.className = "top-movers__toolbar";
    const toolbarFields = document.createElement("div");
    toolbarFields.className = "top-movers__toolbar-fields";
    const filterInput = buildFilterInput(state, () => render());
    const directionControl = buildDirectionFilter(state, () => render());
    toolbarFields.append(filterInput.elem, directionControl.elem);
    const clearSlot = document.createElement("div");
    clearSlot.className = "top-movers__clear-slot";
    clearSlot.setAttribute("aria-live", "polite");
    toolbar.append(toolbarFields, clearSlot);

    const tableWrap = document.createElement("div");
    tableWrap.className = "top-movers__table";

    // ── Footer: page-size selector on the left, pagination on the
    // right. Pairs the two pagination-related controls so the
    // header / toolbar can stay focused on identity + filtering.
    const footer = document.createElement("footer");
    footer.className = "top-movers__footer";
    const pageSize = pageSizeControl(state, () => render());
    const pagination = document.createElement("nav");
    pagination.className = "top-movers__pagination";
    pagination.setAttribute("aria-label", "Top movers pagination");
    footer.append(pageSize, pagination);

    card.append(header, toolbar, tableWrap, footer);
    parent.replaceChildren(card);

    function render() {
        const filtered = filterMovers(
            diff.top_movers,
            state.filterText,
            state.filterDirection,
        );
        clampPageIndex(state, filtered.length);
        tableWrap.replaceChildren(renderTable(filtered, diff, state, render));
        pagination.replaceChildren(...renderPagination(filtered, state, render));
        renderClearButton(clearSlot, isFiltering(state), () => {
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

function isFiltering(state) {
    return state.filterText.trim() !== "" || state.filterDirection !== "all";
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

// Substring + direction filter. Substring is case-insensitive
// and matches either "AS<num>" or the operator label from
// asn-names.json; users can paste either a number ("16509"),
// the AS-prefixed form ("AS16509"), or part of an operator
// ("amazon"). Direction filter compares against directionRank()
// so it stays in sync with both the sort key and the rendered
// arrow.
function filterMovers(movers, filterText, filterDirection) {
    const needle = filterText.trim().toLowerCase();
    const direction = DIRECTION_FILTERS.find((d) => d.value === filterDirection);
    const directionRankWanted = direction?.rank ?? null;
    if (!needle && directionRankWanted === null) return movers;
    return movers.filter((row) => {
        if (directionRankWanted !== null && directionRank(row) !== directionRankWanted) {
            return false;
        }
        if (!needle) return true;
        return matchesText(row, needle);
    });
}

function matchesText(row, needle) {
    const asnStr = String(row.asn);
    if (asnStr.includes(needle)) return true;
    if (`as${asnStr}`.includes(needle)) return true;
    const operator = nameFor(row.asn);
    if (operator && operator.toLowerCase().includes(needle)) return true;
    return false;
}

// Filtering can shrink the matrix below the user's current page;
// snap back to the last in-range page so the table never lands
// on an empty slice. Page 0 is the safe fallback when nothing
// matches.
function clampPageIndex(state, filteredCount) {
    if (filteredCount === 0) {
        state.pageIndex = 0;
        return;
    }
    const lastPage = Math.max(
        0,
        Math.ceil(filteredCount / state.pageSize) - 1,
    );
    if (state.pageIndex > lastPage) state.pageIndex = lastPage;
}

// Stable sort over a shallow copy so the cached diff.top_movers
// array on the payload stays untouched. JavaScript's Array.sort
// is stable since ES2019, so a fresh sort by direction keeps the
// metrics.json input order (by changes desc) as the tiebreaker
// for rows in the same flow category.
function sortMovers(movers, field, dir) {
    const copy = movers.slice();
    copy.sort((a, b) => compareMovers(a, b, field, dir));
    return copy;
}

function compareMovers(a, b, field, dir) {
    const sign = dir === "asc" ? 1 : -1;
    if (field === "asn") return sign * (a.asn - b.asn);
    if (field === "changes") return sign * (a.changes - b.changes);
    if (field === "touched")
        return sign * (touchedRatio(a) - touchedRatio(b));
    if (field === "direction")
        return sign * (directionRank(a) - directionRank(b));
    return 0;
}

// Significance multiplier used for both the "Touched" column and
// its sort key. The denominator is the larger of the per-AS
// prefix counts on either side, so the ratio has a stable
// interpretation: "the diff visited this many trie positions for
// every prefix this AS holds in the larger snapshot".
//
// Values above 1.0 are real — and they are not a bug. `changes`
// is counted at the binary trie's diff granularity, which walks
// to the finest split present anywhere in the comparison; the
// per-AS prefix count is measured at leaf granularity, which
// aggregates contiguous ranges. When one map holds an AS as a
// single large block (one leaf) and the other splits the same
// range into many small pieces (many leafs), the diff visits one
// position per fine-grained piece, but the leaf count stays at
// one or close to it. That is what makes the multiplier exceed 1
// — see the tooltip on TOP_MOVERS_INFO for the user-facing
// explanation. We expose the raw multiplier on purpose; capping
// it to 100 % would hide the very fragmentation event Bitcoin
// Core reviewers want to spot.
//
// Rows without per-side counts (older payloads or ASes whose
// presence is zero on both sides) collapse to 0 so the sort
// stays well-defined and the cell can render a dash.
function touchedRatio(row) {
    const presence = Math.max(row.entries_in_a ?? 0, row.entries_in_b ?? 0);
    return presence > 0 ? row.changes / presence : 0;
}

// Ordinal rank used to sort the Direction column. Ascending sort
// produces gained -> lost -> exchanged -> unmapped, which reads
// as "what kind of flow happened" rather than the underlying
// counterpart number. The same buckets feed describeFlow below,
// so the ranking matches whatever glyph the cell renders.
function directionRank(row) {
    if (!row.primary_counterpart) return 4; // -> unmapped
    const gained = row.gained ?? 0;
    const lost = row.lost ?? 0;
    if (gained > 0 && lost > 0) return 3; // exchanged
    if (gained > 0) return 1;
    if (lost > 0) return 2;
    // Older payloads without per-direction counts (gained/lost both
    // undefined) collapse onto "exchanged" via describeFlow; match
    // that ranking so the sort agrees with what the cell shows.
    return 3;
}

function tableHead(state, onChange) {
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

function tableBody(rows, totalChanges, startIndex) {
    const tbody = document.createElement("tbody");
    rows.forEach((row, i) => {
        const shareOfAll =
            formatPercent(row.changes / Math.max(totalChanges, 1), 1);
        const touchedLabel = touchedLabelFor(row);
        const tr = document.createElement("tr");
        tr.append(
            cell(startIndex + i + 1, "top-movers__rank"),
            cell(asnCell(row.asn), "top-movers__asn"),
            cell(formatNumber(row.changes), "top-movers__num"),
            cell(touchedLabel, "top-movers__num"),
            cell(shareOfAll, "top-movers__num"),
            directionCell(row),
        );
        tbody.append(tr);
    });
    return tbody;
}

// Per-row cell text for the "Touched" column.
//
// The cell renders the raw multiplier (changes / max-presence)
// with a unit suffix of "\u00d7" so the reader cannot confuse it
// with the percentage columns next to it. The value is left
// uncapped on purpose: values above 1.00 are a real signal that
// one map fragments this AS while the other aggregates it, and
// flattening them to "100 %" used to hide exactly the diffs a
// Bitcoin Core reviewer would want to spot. See touchedRatio()
// for the underlying mechanism.
//
// Two intentional special-cases:
//
//   1. Rows with no per-side prefix counts (older payloads) get
//      an em-dash so the reader is never shown "0.00\u00d7" for
//      a presence we genuinely do not know.
//   2. Sub-0.01 values round to "<0.01\u00d7" so the cell never
//      reads as "0.00\u00d7" (which would suggest the diff did
//      not touch the AS at all, even though it did).
function touchedLabelFor(row) {
    if (row.entries_in_a === undefined && row.entries_in_b === undefined) {
        return "\u2014";
    }
    const ratio = touchedRatio(row);
    return formatTouchedRatio(ratio);
}

function formatTouchedRatio(ratio) {
    if (ratio === 0) return "0\u00d7";
    if (ratio < 0.01) return "<0.01\u00d7";
    const decimals = ratio < 10 ? 2 : 1;
    return `${ratio.toFixed(decimals)}\u00d7`;
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
// The unmapped row uses the same DOM scaffold as a regular
// counterpart row (inner flex, arrowGlyph, asn-cell __num span)
// so its arrow shares the muted colour of the other arrows and
// its label inherits the same font weight as the AS numbers
// rendered above. Plain textContent would give the cell a
// different glyph weight and break the visual rhythm.
//
// The flex layout sits on an inner <span>, not on the <td> itself,
// so the table layout engine still measures the cell as a regular
// table-cell and distributes column widths correctly.
function directionCell(row) {
    const td = cell("", "top-movers__direction");
    const inner = document.createElement("span");
    inner.className = "top-movers__direction-inner";

    const counterpart = row.primary_counterpart;
    if (!counterpart) {
        inner.append(
            arrowGlyph(ARROW.UNMAPPED, "prefixes no longer resolve to any ASN"),
            unmappedLabel(),
        );
        td.append(inner);
        return td;
    }

    const flow = describeFlow(row, counterpart);
    if (!flow) return td;

    inner.append(arrowGlyph(flow.arrow, flow.tooltip), asnCell(counterpart));
    td.append(inner);
    return td;
}

// Counterpart placeholder for ASes that lost their mapping entirely
// (no destination ASN). Mirrors asnCell()'s span scaffold so the
// label inherits asn-cell__num's weight and colour. Used only by
// directionCell; intentionally not exported.
function unmappedLabel() {
    const wrap = document.createElement("span");
    wrap.className = "asn-cell";
    const num = document.createElement("span");
    num.className = "asn-cell__num";
    num.textContent = "unmapped";
    wrap.append(num);
    return wrap;
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

// Compact / Detailed switch shares the pill-style mode-switch
// component with the drift chart, so the table header speaks the
// same control language as the drift card. Compact hides the
// operator name under each AS number; Detailed shows it.
function viewModeSwitch(state, onChange) {
    return createModeSwitch({
        options: [
            { value: "compact", label: "Compact" },
            { value: "detailed", label: "Detailed" },
        ],
        value: state.showNames ? "detailed" : "compact",
        onChange: (next) => {
            state.showNames = next === "detailed";
            saveShowNames(state.showNames);
            onChange();
        },
        ariaLabel: "Top movers view mode",
    });
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

function renderPagination(filteredMovers, state, onChange) {
    const totalPages = Math.ceil(filteredMovers.length / state.pageSize);
    if (totalPages <= 1) return [];

    return paginationWindow(state.pageIndex, totalPages).map((entry) => {
        if (entry === "ellipsis") {
            const span = document.createElement("span");
            span.className = "top-movers__page-ellipsis";
            span.textContent = "\u2026";
            span.setAttribute("aria-hidden", "true");
            return span;
        }
        const button = document.createElement("button");
        button.type = "button";
        button.className = "top-movers__page";
        if (entry === state.pageIndex) {
            button.classList.add("is-active");
            button.setAttribute("aria-current", "page");
        }
        button.textContent = String(entry + 1);
        button.setAttribute("aria-label", `Page ${entry + 1}`);
        button.addEventListener("click", () => {
            state.pageIndex = entry;
            onChange();
        });
        return button;
    });
}

// Pick which page indices to render and where to insert
// "ellipsis" tokens. Below PAGINATION_FULL_THRESHOLD pages every
// index is shown; above it we keep the first, last, and a one-
// neighbour window around the active page, with extra slots
// expanded at the ends so "1 2 3 … 10" reads naturally instead
// of "1 2 … 10".
function paginationWindow(active, total) {
    if (total <= PAGINATION_FULL_THRESHOLD) {
        return Array.from({ length: total }, (_, i) => i);
    }
    const pages = new Set([0, total - 1]);
    for (let p = active - 1; p <= active + 1; p++) {
        if (p > 0 && p < total - 1) pages.add(p);
    }
    // Near the edges, expand the window inward so the user
    // doesn't see a two-button block ("1 2 … 10") that hides
    // their real position.
    if (active <= 2) [1, 2].forEach((p) => pages.add(p));
    if (active >= total - 3) [total - 3, total - 2].forEach((p) => pages.add(p));

    const sorted = [...pages].sort((a, b) => a - b);
    const result = [];
    for (let i = 0; i < sorted.length; i++) {
        result.push(sorted[i]);
        if (i < sorted.length - 1 && sorted[i + 1] - sorted[i] > 1) {
            result.push("ellipsis");
        }
    }
    return result;
}

// Filter facet builders ─────────────────────────────────────────
// Both builders return { elem, setValue } so the toolbar code can
// treat them uniformly: append the elem, call setValue on Clear.

function buildFilterInput(state, onChange) {
    const elem = document.createElement("div");
    elem.className = "top-movers__filter-field";

    const input = document.createElement("input");
    input.type = "search";
    input.className = "top-movers__filter-input";
    input.placeholder = "Filter by AS number or operator";
    input.value = state.filterText;
    input.setAttribute("aria-label", "Filter top movers");
    input.addEventListener("input", () => {
        // pageIndex reset lives in render via clampPageIndex, but
        // an explicit reset here keeps the first keystroke from
        // briefly landing on a non-existent page before the clamp
        // runs.
        state.filterText = input.value;
        state.pageIndex = 0;
        onChange();
    });

    elem.append(input);
    return {
        elem,
        setValue(next) {
            input.value = next;
        },
    };
}

function buildDirectionFilter(state, onChange) {
    const dropdown = createDropdown({
        options: DIRECTION_FILTERS.map(({ value, label }) => ({ value, label })),
        value: state.filterDirection,
        ariaLabel: "Filter by direction",
        size: "small",
        onChange: (next) => {
            state.filterDirection = next;
            state.pageIndex = 0;
            onChange();
        },
    });
    // Pin a min-width so the trigger stays the same size on every
    // option (the longest label "Exchanged ↔" sets the floor).
    // Without this, switching to "Lost ↘" would shrink the chip
    // and shove the rest of the toolbar around.
    dropdown.classList.add("top-movers__direction-dropdown");
    return {
        elem: dropdown,
        setValue(next) {
            dropdown.setValue(next);
        },
    };
}

// Renders an "✕ Clear" pill into the toolbar's right-hand slot
// whenever a filter narrows the matrix. The element collapses
// out of the layout when no filter is active so the toolbar
// reads as a single field row in the default state.
function renderClearButton(slot, active, onClear) {
    if (!active) {
        slot.replaceChildren();
        return;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "top-movers__clear";
    button.setAttribute("aria-label", "Clear filter");

    const glyph = document.createElement("span");
    glyph.className = "top-movers__clear-glyph";
    glyph.setAttribute("aria-hidden", "true");
    glyph.textContent = "\u2715";

    const text = document.createElement("span");
    text.textContent = "Clear";

    button.append(glyph, text);
    button.addEventListener("click", onClear);
    slot.replaceChildren(button);
}

