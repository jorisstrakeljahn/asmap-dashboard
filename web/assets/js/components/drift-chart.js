// Drift composition chart. Two modes:
//
//   - "cumulative" diffs each build against the oldest unfilled
//     baseline and renders as four lines (three categories +
//     dashed Total).
//   - "step" diffs against the immediately previous diffable
//     build and renders as a stacked bar per release; the total
//     stack height equals "drift vs previous" on the overview.
//
// All ratios use total / max(entries_a, entries_b) so they
// share a denominator with the diff explorer's match-rate banner.

import { mountResponsiveChart } from "../charts/chart-base.js";
import { buildTooltipBody } from "../charts/chart-tooltip.js";
import { buildLineChart } from "../charts/line-chart.js";
import { buildStackedBarChart } from "../charts/stacked-bar-chart.js";
import { formatDate, formatNumber, formatPercent } from "../format.js";
import { mutedNote } from "../utils/dom.js";
import { t } from "../utils/i18n.js";
import { unfilledProfile } from "../utils/map-variants.js";
import { createChartLegend } from "./chart-legend.js";
import { computePoints } from "./drift-chart-points.js";
import { createInfoTooltip } from "./info-tooltip.js";

// Render order: three categories first, Total last so its
// dashed overlay stays visually on top.
const SERIES = [
    {
        key: "reassigned",
        labelKey: "history.driftSeries.reassigned",
        accessor: (point) => point.reassigned_ratio,
        lineClass: "chart__line--reassigned",
        dotClass: "chart__dot--reassigned",
        barClass: "chart__bar--reassigned",
        swatchClass: "chart-legend__swatch--reassigned",
    },
    {
        key: "newly_mapped",
        labelKey: "history.driftSeries.newlyMapped",
        accessor: (point) => point.newly_ratio,
        lineClass: "chart__line--newly-mapped",
        dotClass: "chart__dot--newly-mapped",
        barClass: "chart__bar--newly-mapped",
        swatchClass: "chart-legend__swatch--newly-mapped",
    },
    {
        key: "unmapped",
        labelKey: "history.driftSeries.unmapped",
        accessor: (point) => point.unmapped_ratio,
        lineClass: "chart__line--unmapped",
        dotClass: "chart__dot--unmapped",
        barClass: "chart__bar--unmapped",
        swatchClass: "chart-legend__swatch--unmapped",
    },
    {
        key: "total",
        labelKey: "history.driftSeries.total",
        accessor: (point) => point.total_ratio,
        lineClass: "chart__line--total",
        dotClass: "chart__dot--total",
        swatchClass: "chart-legend__swatch--total",
    },
];

// Resolve labels at render time so the legend / tooltip pick up
// the current locale on every redraw.
const seriesWithLabels = (list) =>
    list.map((s) => ({ ...s, label: t(s.labelKey) }));

// Reading order varies by mode. Cumulative leads with Total
// because the aggregate is the headline reading; step omits
// Total entirely because the stack height *is* the total, and
// the legend would otherwise carry a toggle that does nothing.
const READING_ORDER_BY_MODE = {
    cumulative: ["total", "reassigned", "newly_mapped", "unmapped"],
    step: ["reassigned", "newly_mapped", "unmapped"],
};
const SERIES_BY_KEY = Object.fromEntries(SERIES.map((s) => [s.key, s]));
const seriesInReadingOrder = (mode) =>
    READING_ORDER_BY_MODE[mode].map((k) => SERIES_BY_KEY[k]);

const MODE_KEYS = {
    cumulative: "history.driftCumulative",
    step: "history.driftStep",
};

function presetFor(mode) {
    const ns = MODE_KEYS[mode];
    if (!ns) return null;
    return {
        title: t(`${ns}.title`),
        info: t(`${ns}.info`),
        infoAria: t(`${ns}.infoAria`),
        ariaLabel: t(`${ns}.ariaLabel`),
    };
}

// One card per mount. The caller (maps-tab) mounts twice
// (cumulative + step), with its own ``hidden`` Set per card.
export function mount(parent, maps, diffs, options = {}) {
    if (!parent) return;
    const preset = presetFor(options.mode);
    if (!preset) {
        throw new Error(`drift-chart: unknown mode ${options.mode}`);
    }
    const emptyMessage = t("history.emptyDrift");
    if (!Array.isArray(maps) || maps.length < 2) {
        parent.replaceChildren(mutedNote(emptyMessage));
        return;
    }
    if (!Array.isArray(diffs) || diffs.length === 0) {
        parent.replaceChildren(mutedNote(emptyMessage));
        return;
    }

    const sortedMaps = [...maps].sort((a, b) =>
        a.released_at.localeCompare(b.released_at),
    );
    // Cumulative needs at least one unfilled anchor; step needs
    // at least two diffable builds.
    if (!sortedMaps.some((m) => unfilledProfile(m) !== null)) {
        parent.replaceChildren(mutedNote(emptyMessage));
        return;
    }

    const state = options.state ?? { hidden: new Set() };
    if (!state.hidden) state.hidden = new Set();

    const card = document.createElement("article");
    card.className = "card chart-card drift-chart";

    const header = buildHeader(preset);
    const legend = createChartLegend({
        entries: seriesWithLabels(seriesInReadingOrder(options.mode)),
        hidden: state.hidden,
        onToggle: (key) => {
            if (state.hidden.has(key)) state.hidden.delete(key);
            else state.hidden.add(key);
            ctrl?.rerender();
        },
    });
    const chartSlot = document.createElement("div");
    chartSlot.className = "drift-chart__plot";

    card.append(header, legend, chartSlot);
    parent.replaceChildren(card);

    const ctrl = mountResponsiveChart(chartSlot, {
        title: null,
        draw: ({ width, height, layout }) =>
            buildChart(
                sortedMaps,
                computePoints(sortedMaps, diffs, options.mode),
                options.mode,
                state.hidden,
                preset.ariaLabel,
                width,
                height,
                layout,
                options,
            ),
    });
}

// ---- Card header (label, info) ----------------------------------

function buildHeader(preset) {
    const header = document.createElement("div");
    header.className = "drift-chart__header";

    const label = document.createElement("span");
    label.className = "card__label uppercase-label";
    label.textContent = preset.title.toUpperCase();
    header.append(label);

    const info = createInfoTooltip({
        body: preset.info,
        ariaLabel: preset.infoAria,
    });
    info.classList.add("drift-chart__info");
    header.append(info);

    return header;
}

// ---- Chart assembly ---------------------------------------------

function buildChart(
    sortedMaps,
    points,
    mode,
    hidden,
    ariaLabel,
    width,
    height,
    layout,
    options,
) {
    // Step's stack height already reads as the total, so the
    // separate Total series is filtered out here rather than
    // leaking ``mode === "step"`` into stacked-bar-chart.js.
    const candidates = mode === "step"
        ? SERIES.filter((s) => s.key !== "total")
        : SERIES;
    const visibleSeries = seriesWithLabels(
        candidates.filter((s) => !hidden.has(s.key)),
    );
    if (visibleSeries.length === 0) {
        return mutedNote(t("history.allSeriesHidden"));
    }

    const valueAt = (key, slotIndex) => {
        const point = points[slotIndex];
        if (!point.present) return null;
        return SERIES_BY_KEY[key].accessor(point);
    };

    // Cumulative tracks the tallest single series; step tracks
    // the tallest stack, so toggling a category off shrinks every
    // bar instead of leaving headroom.
    const yMax = mode === "step"
        ? maxStackHeight(points, visibleSeries)
        : maxSeriesValue(points, visibleSeries);
    if (yMax == null) {
        return mutedNote(t("history.noDriftData"));
    }

    const spec = {
        timestamps: sortedMaps.map((m) => new Date(m.released_at).getTime()),
        visibleSeries,
        valueAt,
        yMin: 0,
        // 1 % floor: niceTicks needs a non-zero upper bound to
        // stay usable when every plotted slot is zero.
        yMax: Math.max(0.01, yMax),
        yFormat: (tick) => formatPercent(tick, 0),
        yTitle: null,
        ariaLabel,
        tooltipBodyAt: (slotIndex) =>
            buildTooltipBody({
                title: formatDate(sortedMaps[slotIndex].released_at),
                rows: hoverRows(points[slotIndex], mode),
                footer: footerFor(points[slotIndex], mode),
            }),
    };

    if (mode === "step") {
        return buildStackedBarChart(spec, width, height, layout, options);
    }
    return buildLineChart(spec, width, height, layout, options);
}

function maxSeriesValue(points, visibleSeries) {
    let best = null;
    for (const point of points) {
        if (!point.present) continue;
        for (const series of visibleSeries) {
            const value = series.accessor(point);
            if (value == null) continue;
            if (best == null || value > best) best = value;
        }
    }
    return best;
}

function maxStackHeight(points, visibleSeries) {
    let best = null;
    for (const point of points) {
        if (!point.present) continue;
        let stack = 0;
        for (const series of visibleSeries) {
            const value = series.accessor(point);
            if (value == null || value <= 0) continue;
            stack += value;
        }
        if (best == null || stack > best) best = stack;
    }
    return best;
}

// Reading order: cumulative leads with Total; step surfaces it
// as a footer because the stack height already conveys it.
// Hidden series still show up — the tooltip is the inspection
// surface.
function hoverRows(point, mode) {
    const totalLabel = t("history.driftSeries.total");
    if (!point.present) {
        return [[totalLabel, t("history.driftSeries.noDiff")]];
    }
    const series = seriesWithLabels(seriesInReadingOrder(mode));
    const rows = series.map((s) => {
        const pct = formatPercent(s.accessor(point), 1);
        if (s.key === "total") {
            return [
                s.label,
                t("history.driftSeries.totalWithCount", {
                    pct,
                    count: formatNumber(point.total_changes),
                }),
            ];
        }
        return [s.label, pct];
    });
    if (mode === "step") {
        rows.push([
            totalLabel,
            t("history.driftSeries.totalWithCount", {
                pct: formatPercent(point.total_ratio, 1),
                count: formatNumber(point.total_changes),
            }),
        ]);
    }
    return rows;
}

function footerFor(point, mode) {
    if (!point.present || !point.vs) return null;
    const date = formatDate(point.vs.released_at);
    return mode === "cumulative"
        ? t("history.driftSeries.sinceDate", { date })
        : t("history.driftSeries.vsDate", { date });
}
