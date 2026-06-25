// Top-operator breakdown for one crawler (picked via the header
// source switch) as stacked vertical bars: one bar per snapshot,
// segmented into that snapshot's actual top five operators by node
// share, so the stack height is the true CR5 of that period.
//
// Why bars, not a fixed-set line chart: summing the same five
// window-wide top operators every period understates the combined
// top-5 when a riser enters the tier. Re-electing the top five per
// period keeps the height an honest CR5. (Review feedback, fjahr.)
//
// No static legend — the cast changes per bar. Identity lives in the
// hover tooltip, one colour-dotted row per segment. Each operator
// keeps one stable colour across bars (by aggregate share), so the
// eye can follow it through reshuffles.

import { mountTimeSeriesCard } from "../../charts/chart-card.js";
import { buildTooltipBody } from "../../charts/chart-tooltip.js";
import { buildStackedBarChart } from "../../charts/stacked-bar-chart.js";
import { formatDate, formatPercent } from "../../format.js";
import { nameFor } from "../../asn-names.js";
import { mutedNote } from "../../utils/dom.js";
import { t } from "../../utils/i18n.js";

// How many operators each bar breaks out. Five is the conventional
// concentration cut (CR5) and keeps a stack legible.
const OPERATOR_LIMIT = 5;

// Palette colour slots (tokens.css --color-series-1..10). The union
// of per-period top-5 operators runs to ~10 on current data; beyond
// that the colours cycle and the tooltip dot keeps rows unambiguous.
const COLOR_SLOTS = 10;

export function mountOperatorsChart(parent, { snapshots, bounds, headerExtra = null }) {
    if (!parent) return;

    const rows = buildRows(snapshots, bounds.cutoff);
    if (rows.length === 0) {
        parent.replaceChildren(mutedNote(t("network.empty")));
        return;
    }
    const palette = assignColors(rows);

    mountTimeSeriesCard(parent, {
        title: t("network.concentration.operatorsTitle"),
        lede: t("network.concentration.operatorsLede"),
        headerExtra,
        drawPlot: ({ width, height, layout }) =>
            drawPlot(rows, palette, bounds, width, height, layout),
    });
}

// One row per snapshot inside the picked range: the snapshot's own
// top five (top_ases is sorted by node count in the pipeline) plus
// their combined share. Shares arrive as 0..1 ratios and are kept
// that way here; the draw pass scales to percent.
function buildRows(snapshots, cutoff) {
    const rows = [];
    for (const sn of snapshots) {
        const ts = sn.timestamp * 1000;
        if (ts < cutoff) continue;
        const top = (sn.top_ases ?? []).slice(0, OPERATOR_LIMIT);
        if (top.length === 0) continue;
        rows.push({
            ts,
            label: sn.label,
            top,
            combined: top.reduce((sum, e) => sum + e.share, 0),
        });
    }
    return rows;
}

// asn -> colour slot, assigned by aggregate share across the visible
// rows so the biggest operators get the most prominent slots and each
// keeps its colour on every bar.
function assignColors(rows) {
    const totals = new Map();
    for (const row of rows) {
        for (const entry of row.top) {
            totals.set(entry.asn, (totals.get(entry.asn) ?? 0) + entry.share);
        }
    }
    const palette = new Map();
    const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    ranked.forEach(([asn], idx) => {
        palette.set(asn, (idx % COLOR_SLOTS) + 1);
    });
    return palette;
}

function drawPlot(rows, palette, bounds, width, height, layout) {
    // The scaffold wants a fixed series list. Series = the union of
    // every bar's top five, stacked in palette order so a segment
    // never jumps inside the stack; a bar omits operators not in its
    // own top five. Largest aggregate sits at the baseline.
    const series = [...palette.entries()].map(([asn, slot]) => ({
        key: `as-${asn}`,
        asn,
        barClass: `chart__bar--op${slot}`,
    }));

    const shareAt = new Map(
        rows.map((row, i) => [i, new Map(row.top.map((e) => [e.asn, e.share]))]),
    );
    const valueAt = (key, slotIndex) => {
        const share = shareAt.get(slotIndex)?.get(Number(key.slice(3)));
        return share == null ? null : share * 100;
    };

    const yMax = Math.max(...rows.map((row) => row.combined)) * 100;

    return buildStackedBarChart(
        {
            timestamps: rows.map((row) => row.ts),
            visibleSeries: series,
            valueAt,
            yMin: 0,
            yMax,
            yFormat: (v) => `${v}%`,
            yTitle: null,
            ariaLabel: t("network.concentration.operatorsAria"),
            tooltipBodyAt: (i) => tooltipBody(rows[i], palette),
        },
        width,
        height,
        layout,
        { domainStart: bounds.domainStart, domainEnd: bounds.domainEnd },
    );
}

// Tooltip: the bar's top five in rank order (largest first, reverse
// of the visual stack), each with its segment's colour dot, then the
// combined CR5 the stack height shows.
function tooltipBody(row, palette) {
    const rows = row.top.map((entry) => [
        operatorLabel(entry.asn),
        formatPercent(entry.share),
        `chart-legend__swatch--op${palette.get(entry.asn)}`,
    ]);
    rows.push([
        t("network.concentration.combinedLabel", { count: row.top.length }),
        formatPercent(row.combined),
    ]);
    return buildTooltipBody({ title: formatDate(row.label), rows });
}

// Operator name when known, bare AS number otherwise. Names keep
// the tooltip self-explanatory in the absence of a legend.
function operatorLabel(asn) {
    return nameFor(asn) ?? `AS${asn}`;
}
