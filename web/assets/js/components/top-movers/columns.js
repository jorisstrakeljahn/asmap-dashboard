// Column metadata, table header, and per-column sort affordance. The column
// array is the single source of truth for both <th> headers and the per-cell
// classes consumed by rows.js.

import { html, render } from "../../vendor/lit-html.js";
import { t } from "../../utils/i18n.js";
import { accessorsFor } from "./units.js";

// labelKey resolves at render time so a locale swap repaints headers without a
// rebuild; Share reads its key off the accessor bundle so it renames with the
// currency picker. defaultDir sets first-click direction: numeric desc,
// ordinal asc.
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
            // The currency-specific header ("% of all IPv4") is too long for
            // the single-line mobile sort bar, so the stacked card view swaps
            // in this short label via CSS.
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

export function renderTableHead(thead, state, onChange) {
    render(
        html`
            <tr>
                ${tableColumns(state.unit).map((column) =>
                    headerCell(column, state, onChange),
                )}
            </tr>
        `,
        thead,
    );
}

// Sortable headers render a button so keyboard users get the same affordance
// as click. Only the active column carries the chevron; cold columns stay
// text-only.
function headerCell(column, state, onChange) {
    const label = column.labelKey ? t(column.labelKey) : "";
    if (!column.sortable) {
        return html`<th class=${column.className}>${label}</th>`;
    }

    const isActive = state.sortField === column.field;
    const dir = isActive ? state.sortDir : null;
    const ariaSort =
        dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none";

    const onClick = () => {
        if (isActive) {
            state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
        } else {
            state.sortField = column.field;
            state.sortDir = column.defaultDir;
        }
        state.pageIndex = 0;
        onChange();
    };

    const buttonAria = isActive
        ? t("topMovers.sort.activeAria", {
              column: label,
              direction: t(
                  state.sortDir === "asc"
                      ? "topMovers.sort.ascending"
                      : "topMovers.sort.descending",
              ),
          })
        : t("topMovers.sort.inactiveAria", { column: label });

    return html`
        <th class=${column.className} aria-sort=${ariaSort}>
            <button
                type="button"
                class="top-movers__sort-button ${isActive ? "is-active" : ""}"
                aria-label=${buttonAria}
                @click=${onClick}
            >
                <span
                    class="top-movers__sort-label ${column.shortLabelKey
                        ? "top-movers__sort-label--full"
                        : ""}"
                    >${label}</span
                >
                ${column.shortLabelKey
                    ? html`<span
                          class="top-movers__sort-label top-movers__sort-label--short"
                          aria-hidden="true"
                          >${t(column.shortLabelKey)}</span
                      >`
                    : ""}
                ${isActive ? sortChevron(state.sortDir) : ""}
            </button>
        </th>
    `;
}

function sortChevron(direction) {
    return html`
        <svg
            class="top-movers__sort-chevron"
            viewBox="0 0 12 12"
            width="10"
            height="10"
            aria-hidden="true"
        >
            <path
                d=${direction === "asc" ? "M3 7.5L6 4.5L9 7.5" : "M3 4.5L6 7.5L9 4.5"}
                stroke="currentColor"
                stroke-width="1.5"
                fill="none"
                stroke-linecap="round"
                stroke-linejoin="round"
            ></path>
        </svg>
    `;
}
