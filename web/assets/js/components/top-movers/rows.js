// Row builders for the Top Movers table body. Rendered with vendored lit-html:
// each template mirrors its markup so the <tr>/<td> structure reads
// top-to-bottom. index.js routes both the populated and empty states through
// here so lit stays the single writer of the persistent <tbody>.

import { html, render } from "../../vendor/lit-html.js";
import { ARROW, EM_DASH, TIMES } from "../../utils/symbols.js";
import { asnCell, labelFor } from "../../asn-names.js";
import {
    familyUnitLabel,
    formatCoverage,
    formatNumber,
    formatPercent,
} from "../../format.js";
import { t } from "../../utils/i18n.js";
import { mutedNote } from "../../utils/dom.js";
import { touchedRatio } from "./sort.js";
import { accessorsFor } from "./units.js";

// The grid has four columns (rank, AS, share, direction); the empty-state
// note spans all of them.
const COLUMN_COUNT = 4;

// unitTotalChanges is the diff-level total in the active currency - the Share
// denominator. Row values come through the unit accessor table so cell, sort
// field and header always read the same currency. Each row carries a native
// title with the longer story (raw counts, footprint per side, Touched ratio);
// Touched has no column because Share answers the more common question.
export function renderTableBody(tbody, rows, unitTotalChanges, startIndex, unit) {
    const accessors = accessorsFor(unit);
    render(
        rows.map((row, i) => {
            const changes = accessors.rowChanges(row);
            const shareOfAll = formatPercent(
                changes / Math.max(unitTotalChanges, 1),
                1,
            );
            return html`
                <tr title=${rowDetailTooltip(row, unit, changes)}>
                    <td class="top-movers__rank">${startIndex + i + 1}</td>
                    <td class="top-movers__asn">${asnCell(row.asn)}</td>
                    <td class="top-movers__num">${shareOfAll}</td>
                    ${directionCell(row, unit)}
                </tr>
            `;
        }),
        tbody,
    );
}

// Empty-state body: one full-width row so the <thead> stays put and the markup
// stays valid. Same lit render() as the populated body, so the <tbody> never
// has two writers.
export function renderEmptyBody(tbody) {
    render(
        html`
            <tr>
                <td class="top-movers__empty" colspan=${COLUMN_COUNT}>
                    ${mutedNote(t("topMovers.noMatches"))}
                </td>
            </tr>
        `,
        tbody,
    );
}

// Row hover text: keeps the cells short by parking the deeper story (raw
// counts per side, Touched ratio, AS name) in the native browser tooltip.
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

// Direction column for one row. Inactive rows are pruned in index.js; the
// em-dash branch is a defensive fallback. Two live branches: an unmapped
// sentinel counterpart (ASN 0) vs a real AS, the arrow following gained/lost
// either way. Kept in lockstep with directionRank in sort.js so filter and cell
// agree.
function directionCell(row, unit) {
    const accessors = accessorsFor(unit);
    const gained = accessors.rowGained(row);
    const lost = accessors.rowLost(row);
    const counterpart = accessors.rowPrimaryCounterpart(row);

    if (gained === 0 && lost === 0) {
        return html`
            <td class="top-movers__direction top-movers__direction--inactive">
                ${EM_DASH}
            </td>
        `;
    }

    const flow = describeFlow(gained, lost, counterpart);
    // Arrow span on one line so its text content is exactly the glyph; the flex
    // container ignores inter-item whitespace, so spacing comes from its gap.
    return html`
        <td class="top-movers__direction">
            <span class="top-movers__direction-inner">
                <span class="top-movers__arrow" title=${flow.tooltip}>${flow.arrow}</span>
                ${counterpart ? asnCell(counterpart) : unmappedLabel()}
            </span>
        </td>
    `;
}

function unmappedLabel() {
    return html`
        <span class="asn-cell">
            <span class="asn-cell__num">${t("topMovers.direction.unmappedLabel")}</span>
        </span>
    `;
}

// Arrow + tooltip from the (gained, lost, counterpart) triplet. The tooltip key
// varies on counterpart presence so "gained from AS{n}" and "newly mapped" stay
// distinct.
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
