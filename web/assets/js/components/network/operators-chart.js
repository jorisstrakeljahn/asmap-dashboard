// Top-operator breakdown (KIT only) as stacked vertical bars: one
// bar per snapshot, segmented into that snapshot's *actual* top
// five operators by node share, so the stack height is the true
// top-5 concentration ratio of that period.
//
// Why bars and not the earlier fixed-set line chart: picking the
// five operators with the highest share over the whole window and
// summing those same five every period silently understates the
// combined top-5 whenever a riser enters the tier — the sum then
// covers ranks 1,2,3,5,6 of that period without saying so. Bars
// re-elect the top five per period, so the height is always the
// honest CR5. (Review feedback from fjahr.)
//
// There is no static legend: the cast changes from bar to bar, so
// a fixed legend would either lie or sprawl. Identity lives in the
// hover tooltip instead, one colour-dotted row per segment. Each
// operator that ever enters a top five still keeps one stable
// colour across all bars (assigned by aggregate share over the
// window), so the eye can follow an operator through reshuffles.

import { mountResponsiveChart } from "../../charts/chart-base.js";
import { buildTooltipBody } from "../../charts/chart-tooltip.js";
import { buildStackedBarChart } from "../../charts/stacked-bar-chart.js";
import { formatDate } from "../../format.js";
import { nameFor } from "../../asn-names.js";
import { mutedNote } from "../../utils/dom.js";
import { t } from "../../utils/i18n.js";
import { createInfoTooltip } from "../info-tooltip.js";

// How many operators each bar breaks out. Five is the conventional
// concentration cut (CR5) and keeps a stack legible.
const OPERATOR_LIMIT = 5;

// Stable colour slots available in the palette (tokens.css
// --color-series-1..10). The union of per-period top-5 operators
// runs to ~10 on current data; if it ever outgrows the palette the
// colours cycle and the tooltip dot keeps rows unambiguous.
const COLOR_SLOTS = 10;

export function mountOperatorsChart(parent, { snapshots, bounds }) {
    if (!parent) return;

    const rows = buildRows(snapshots, bounds.cutoff);
    if (rows.length === 0) {
        parent.replaceChildren(mutedNote(t("network.empty")));
        return;
    }
    const palette = assignColors(rows);

    const card = document.createElement("article");
    card.className = "card chart-card network-chart";
    card.append(buildHeader());

    const slot = document.createElement("div");
    slot.className = "network-chart__plot";
    card.append(slot);
    parent.replaceChildren(card);

    mountResponsiveChart(slot, {
        title: null,
        draw: ({ width, height, layout }) =>
            drawPlot(rows, palette, bounds, width, height, layout),
    });
}

function buildHeader() {
    const header = document.createElement("div");
    header.className = "network-chart__header";

    const label = document.createElement("span");
    label.className = "card__label uppercase-label";
    label.textContent = t("network.concentration.operatorsTitle").toUpperCase();
    header.append(label);

    const tip = createInfoTooltip({
        body: t("network.concentration.operatorsInfo"),
        ariaLabel: t("network.concentration.operatorsInfoAria"),
    });
    tip.classList.add("network-chart__info");
    header.append(tip);
    return header;
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

// asn -> colour slot index, assigned in order of aggregate share
// across the visible rows so the biggest operators claim the most
// prominent palette slots and every operator keeps its colour on
// every bar it appears in.
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
    // The scaffold wants a fixed series list with valueAt(key, slot).
    // Series = the union of every bar's top five, stacked in aggregate
    // order (palette order) so an operator's segment never jumps
    // around inside the stack; a bar simply omits the operators that
    // are not in *its* top five. Largest aggregate sits at the
    // baseline.
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

// Tooltip: the bar's own top five in rank order (largest first, the
// reverse of the visual stack so reading starts with the headline
// operator), each with the colour dot matching its segment, then
// the combined CR5 the stack height shows.
function tooltipBody(row, palette) {
    const rows = row.top.map((entry) => [
        operatorLabel(entry.asn),
        formatShare(entry.share),
        `chart-legend__swatch--op${palette.get(entry.asn)}`,
    ]);
    rows.push([
        t("network.concentration.combinedLabel", { count: row.top.length }),
        formatShare(row.combined),
    ]);
    return buildTooltipBody({ title: formatDate(row.label), rows });
}

// Operator name when known, bare AS number otherwise. Names keep
// the tooltip self-explanatory in the absence of a legend.
function operatorLabel(asn) {
    return nameFor(asn) ?? `AS${asn}`;
}

function formatShare(share) {
    return `${(share * 100).toFixed(1)}%`;
}
