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

// ``unitTotalChanges`` is the diff-level total in the active
// currency — the denominator for the Share column. Row values
// come through the unit accessor table so cell, sort field, and
// header always read the same currency.
//
// Each row carries a native title attribute with the longer story
// (raw counts, AS footprint per side, Touched ratio). Touched has
// no column of its own because Share answers the more common
// question; the hover text keeps it discoverable.
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

// Row hover text: keeps the cells short by parking the deeper
// story (raw counts per side, Touched ratio, AS name) in the
// native browser tooltip.
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
// Inactive rows (no gain/loss in the active currency) are pruned
// in index.js; the em-dash branch is a defensive fallback. The
// two live branches: an unmapped-sentinel counterpart (ASN 0,
// labelled "unmapped") vs. a real counterpart AS, with the arrow
// following gained / lost either way.
//
// Kept in lockstep with ``directionRank`` in sort.js — same
// gained / lost / counterpart triplet — so filter and cell agree.
function directionCell(row, unit) {
    const accessors = accessorsFor(unit);
    const gained = accessors.rowGained(row);
    const lost = accessors.rowLost(row);
    const counterpart = accessors.rowPrimaryCounterpart(row);
    const td = cell("", "top-movers__direction");

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
// "gained from AS{n}" and "newly mapped" stay distinct rather
// than one generic message.
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
