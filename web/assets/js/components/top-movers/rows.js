// Row builders for the Top Movers table body.

import { ARROW, EM_DASH, TIMES } from "../../utils/symbols.js";
import { asnCell } from "../../asn-names.js";
import { formatNumber, formatPercent } from "../../format.js";
import { t } from "../../utils/i18n.js";
import { touchedRatio } from "./sort.js";

export function tableBody(rows, totalChanges, startIndex) {
    const tbody = document.createElement("tbody");
    rows.forEach((row, i) => {
        const shareOfAll = formatPercent(
            row.changes / Math.max(totalChanges, 1),
            1,
        );
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

// Accepts either a string (textContent) or a Node (appended).
function cell(content, className) {
    const td = document.createElement("td");
    if (className) td.className = className;
    if (content instanceof Node) td.append(content);
    else td.textContent = String(content);
    return td;
}

// Older payloads without per-side counts render an em-dash;
// sub-0.01 ratios render as "<0.01×" so a real diff never reads
// as "0.00×". See touchedRatio() in sort.js for why values can
// exceed 1.00.
function touchedLabelFor(row) {
    if (row.entries_in_a === undefined && row.entries_in_b === undefined) {
        return EM_DASH;
    }
    return formatTouchedRatio(touchedRatio(row));
}

function formatTouchedRatio(ratio) {
    if (ratio === 0) return `0${TIMES}`;
    if (ratio < 0.01) return `<0.01${TIMES}`;
    const decimals = ratio < 10 ? 2 : 1;
    return `${ratio.toFixed(decimals)}${TIMES}`;
}

// Inner flex span (not the <td>) so the layout engine still
// measures the cell as a regular table-cell. The unmapped row
// reuses the asnCell scaffold so its label inherits the same
// font weight as a normal counterpart.
function directionCell(row) {
    const td = cell("", "top-movers__direction");
    const inner = document.createElement("span");
    inner.className = "top-movers__direction-inner";

    const counterpart = row.primary_counterpart;
    if (!counterpart) {
        inner.append(
            arrowGlyph(ARROW.RIGHT, t("topMovers.direction.tooltip.unmapped")),
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

function unmappedLabel() {
    const wrap = document.createElement("span");
    wrap.className = "asn-cell";
    const num = document.createElement("span");
    num.className = "asn-cell__num";
    num.textContent = t("topMovers.direction.unmappedLabel");
    wrap.append(num);
    return wrap;
}

function describeFlow(row, counterpart) {
    const { gained, lost } = row;
    const hasFlowData = gained !== undefined || lost !== undefined;

    if (!hasFlowData || (gained > 0 && lost > 0)) {
        return {
            arrow: ARROW.LEFT_RIGHT,
            tooltip: t("topMovers.direction.tooltip.exchanged", { counterpart }),
        };
    }
    if (gained > 0) {
        return {
            arrow: ARROW.UP_RIGHT,
            tooltip: t("topMovers.direction.tooltip.gained", { counterpart }),
        };
    }
    if (lost > 0) {
        return {
            arrow: ARROW.DOWN_RIGHT,
            tooltip: t("topMovers.direction.tooltip.lost", { counterpart }),
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
