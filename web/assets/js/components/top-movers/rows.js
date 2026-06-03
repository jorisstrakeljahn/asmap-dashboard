// Row builders for the Top Movers table body.

import { ARROW, EM_DASH, TIMES } from "../../utils/symbols.js";
import { asnCell, labelFor } from "../../asn-names.js";
import {
    familyUnitLabel,
    formatCoverage,
    formatNumber,
    formatPercent,
} from "../../format.js";
import { t } from "../../utils/i18n.js";
import { touchedRatio } from "./sort.js";
import { accessorsFor } from "./units.js";

// ``unitTotalChanges`` is the diff level total in the active
// currency (IPv4 addresses moved across the whole diff, or IPv6
// blocks). It is the denominator for the Share column. The row
// Moved value comes through the unit accessor table so the cell,
// the sort field and the column header always read the same
// currency.
//
// Each row also carries a native title attribute that spells out
// the longer story (raw IPv4 address count or raw IPv6 block
// count, the AS footprint on either side, the Touched ratio).
// Touched is no longer a dedicated column because Share answers
// the more common question (how big was this AS inside this
// diff). The hover text keeps Touched discoverable without
// claiming a column slot.
export function tableBody(rows, unitTotalChanges, startIndex, unit) {
    const accessors = accessorsFor(unit);
    const tbody = document.createElement("tbody");
    rows.forEach((row, i) => {
        const changes = accessors.rowChanges(row);
        const shareOfAll = formatPercent(
            changes / Math.max(unitTotalChanges, 1),
            1,
        );
        const tr = document.createElement("tr");
        tr.title = rowDetailTooltip(row, unit, changes);
        tr.append(
            cell(startIndex + i + 1, "top-movers__rank"),
            cell(asnCell(row.asn), "top-movers__asn"),
            cell(shareOfAll, "top-movers__num"),
            directionCell(row, unit),
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

// Row hover text. Pulled together here so the table cells stay
// single line and short, and the deeper story (raw counts on
// either side, the Touched ratio, the AS name) lives in the
// native browser tooltip every row carries.
function rowDetailTooltip(row, unit, changes) {
    const accessors = accessorsFor(unit);
    const family = accessors.family;
    const presenceA = accessors.rowPresenceA(row);
    const presenceB = accessors.rowPresenceB(row);
    const unitLabel = familyUnitLabel(family);
    const lines = [
        labelFor(row.asn),
        t("topMovers.rowTooltip.moved", {
            value: formatCoverage(changes, family),
            unit: unitLabel,
        }),
        t("topMovers.rowTooltip.footprint", {
            from: formatCoverage(presenceA, family),
            to: formatCoverage(presenceB, family),
            unit: unitLabel,
        }),
        t("topMovers.rowTooltip.touched", {
            value: formatTouchedRatio(touchedRatio(row, unit)),
        }),
        t("topMovers.rowTooltip.entries", {
            count: formatNumber(row.changes ?? 0),
        }),
    ];
    return lines.filter(Boolean).join("\n");
}

function formatTouchedRatio(ratio) {
    if (!Number.isFinite(ratio)) return EM_DASH;
    if (ratio === 0) return `0${TIMES}`;
    if (ratio < 0.01) return `<0.01${TIMES}`;
    const decimals = ratio < 10 ? 2 : 1;
    return `${ratio.toFixed(decimals)}${TIMES}`;
}

// Renders the direction column for one row.
//
// Inactive rows (no gain, no loss in the active currency) are
// pruned in index.js before render so the table only shows
// movers that actually moved something in the active currency.
// The em-dash branch below stays as a defensive fallback in
// case the prune ever leaks an inactive row through.
//
// Otherwise two branches:
//   1. The dominant counterpart is the unmapped sentinel (ASN
//      0) — the flow is to / from the unmapped pool. Arrow and
//      tooltip follow the actual direction so a newly-mapped AS
//      reads as a gain, a fully unmapped AS reads as a loss,
//      and a fragmentation event reads as an exchange. The
//      counterpart label is "unmapped" instead of an AS number.
//   2. A real counterpart AS exists. The arrow follows gained /
//      lost in the active currency and the counterpart is
//      rendered as a regular AS cell.
//
// Keeping this in lockstep with ``directionRank`` in sort.js is
// what makes the filter dropdown and the rendered cell agree —
// both consult the same gained / lost / counterpart triplet.
function directionCell(row, unit) {
    const accessors = accessorsFor(unit);
    const gained = accessors.rowGained(row);
    const lost = accessors.rowLost(row);
    const counterpart = accessors.rowPrimaryCounterpart(row);
    const td = cell("", "top-movers__direction");
    // Drives the inline "Direction" tag the stacked mobile card
    // shows via td.top-movers__direction::before; ignored on the
    // wide table where the column header carries the label.
    td.dataset.label = t("topMovers.columns.direction");

    if (gained === 0 && lost === 0) {
        td.textContent = EM_DASH;
        td.classList.add("top-movers__direction--inactive");
        return td;
    }

    const flow = describeFlow(gained, lost, counterpart);
    const inner = document.createElement("span");
    inner.className = "top-movers__direction-inner";
    inner.append(
        arrowGlyph(flow.arrow, flow.tooltip),
        counterpart ? asnCell(counterpart) : unmappedLabel(),
    );
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

// Picks arrow + tooltip from the (gained, lost, counterpart)
// triplet. The tooltip key varies on counterpart presence so
// "gained addresses from AS{n}" and "newly mapped from the
// unmapped pool" render as distinct, copy-pasteable sentences
// rather than a single generic message.
function describeFlow(gained, lost, counterpart) {
    if (gained > 0 && lost > 0) {
        return {
            arrow: ARROW.LEFT_RIGHT,
            tooltip: counterpart
                ? t("topMovers.direction.tooltip.exchanged", { counterpart })
                : t("topMovers.direction.tooltip.exchangedUnmapped"),
        };
    }
    if (gained > 0) {
        return {
            arrow: ARROW.UP_RIGHT,
            tooltip: counterpart
                ? t("topMovers.direction.tooltip.gained", { counterpart })
                : t("topMovers.direction.tooltip.newlyMapped"),
        };
    }
    return {
        arrow: ARROW.DOWN_RIGHT,
        tooltip: counterpart
            ? t("topMovers.direction.tooltip.lost", { counterpart })
            : t("topMovers.direction.tooltip.unmapped"),
    };
}

function arrowGlyph(glyph, tooltip) {
    const el = document.createElement("span");
    el.className = "top-movers__arrow";
    el.textContent = glyph;
    el.title = tooltip;
    return el;
}
