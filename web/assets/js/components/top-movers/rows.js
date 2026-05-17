// Row builders for the Top Movers table body.
//
// Every row is assembled cell-by-cell so each column can carry
// its own DOM (asnCell, direction cell with arrow + counterpart,
// ...). The cell() helper accepts either a string or a Node so
// the same call shape works for both shapes.

import { ARROW, EM_DASH, TIMES } from "../../utils/symbols.js";
import { asnCell } from "../../asn-names.js";
import { formatNumber, formatPercent } from "../../format.js";
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

// Per-row cell text for the "Touched" column.
//
// The cell renders the raw multiplier (changes / max-presence)
// with a unit suffix of "×" so the reader cannot confuse it with
// the percentage columns next to it. The value is left uncapped
// on purpose: values above 1.00 are a real signal that one map
// fragments this AS while the other aggregates it, and
// flattening them to "100 %" used to hide exactly the diffs a
// Bitcoin Core reviewer would want to spot. See touchedRatio()
// in sort.js for the underlying mechanism.
//
// Two intentional special-cases:
//
//   1. Rows with no per-side prefix counts (older payloads) get
//      an em-dash so the reader is never shown "0.00 x" for a
//      presence we genuinely do not know.
//   2. Sub-0.01 values round to "<0.01 x" so the cell never
//      reads as "0.00 x" (which would suggest the diff did not
//      touch the AS at all, even though it did).
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
// The flex layout sits on an inner <span>, not on the <td>
// itself, so the table layout engine still measures the cell as
// a regular table-cell and distributes column widths correctly.
function directionCell(row) {
    const td = cell("", "top-movers__direction");
    const inner = document.createElement("span");
    inner.className = "top-movers__direction-inner";

    const counterpart = row.primary_counterpart;
    if (!counterpart) {
        inner.append(
            arrowGlyph(ARROW.RIGHT, "prefixes no longer resolve to any ASN"),
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

// Counterpart placeholder for ASes that lost their mapping
// entirely (no destination ASN). Mirrors asnCell()'s span
// scaffold so the label inherits asn-cell__num's weight and
// colour.
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
            arrow: ARROW.LEFT_RIGHT,
            tooltip: `exchanged prefixes with AS${counterpart}`,
        };
    }
    if (gained > 0) {
        return {
            arrow: ARROW.UP_RIGHT,
            tooltip: `gained prefixes from AS${counterpart}`,
        };
    }
    if (lost > 0) {
        return {
            arrow: ARROW.DOWN_RIGHT,
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
