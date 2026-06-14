// Drift composition chart. Two modes:
//
//   - "cumulative" diffs each build against the oldest unfilled
//     baseline and renders as four lines (three categories +
//     dashed Total).
//   - "step" diffs against the immediately previous diffable
//     build and renders as a stacked bar per release; the total
//     stack height equals "drift vs previous" on the overview.
//
// Each render is in one drift unit at a time (IPv4 coverage or
// IPv6 coverage — see DRIFT_* in utils/diffs.js). The unit
// selects which pipeline fields the points read from and is
// surfaced in the card header so the active currency is readable
// at a glance; tooltips append a unit-aware suffix to each
// "Total drift" row so the reader cannot mistake an IPv6 hover
// reading for an IPv4 one.

import { mountTimeSeriesCard } from "../charts/chart-card.js";
import { buildTooltipBody } from "../charts/chart-tooltip.js";
import { buildLineChart } from "../charts/line-chart.js";
import { buildStackedBarChart } from "../charts/stacked-bar-chart.js";
import {
    FAMILY_IPV4,
    FAMILY_IPV6,
    familyUnitLabel,
    formatDate,
    formatPercent,
} from "../format.js";
import {
    DRIFT_IPV4_COVERAGE,
    DRIFT_IPV6_COVERAGE,
} from "../utils/diffs.js";
import { mutedNote } from "../utils/dom.js";
import { t } from "../utils/i18n.js";
import { unfilledProfile } from "../utils/map-variants.js";
import { createChartLegend } from "./chart-legend.js";
import { computePoints } from "./drift-chart-points.js";
import { driftFooter, driftHoverRows } from "./drift-chart-tooltips.js";

const UNIT_KEYS = {
    [DRIFT_IPV4_COVERAGE]: "history.driftUnit.ipv4_coverage",
    [DRIFT_IPV6_COVERAGE]: "history.driftUnit.ipv6_coverage",
};

const UNIT_FAMILY = {
    [DRIFT_IPV4_COVERAGE]: FAMILY_IPV4,
    [DRIFT_IPV6_COVERAGE]: FAMILY_IPV6,
};

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

function presetFor(mode, unit) {
    const ns = MODE_KEYS[mode];
    const unitNs = UNIT_KEYS[unit];
    const family = UNIT_FAMILY[unit];
    if (!ns || !unitNs || !family) return null;
    return {
        title: t(`${ns}.title`),
        unitLabel: t(`${unitNs}.label`),
        unitCountSuffix: familyUnitLabel(family),
        family,
        info: t(`${ns}.info`),
        infoAria: t(`${ns}.infoAria`),
        ariaLabel: t(`${ns}.ariaLabel`),
    };
}

// One card per mount. The caller (maps-tab) mounts twice
// (cumulative + step), with its own ``hidden`` Set per card and
// a shared ``unit`` so the two cards always read the same
// currency.
export function mount(parent, maps, diffs, options = {}) {
    if (!parent) return;
    const unit = options.unit ?? DRIFT_IPV4_COVERAGE;
    const preset = presetFor(options.mode, unit);
    if (!preset) {
        throw new Error(
            `drift-chart: unknown mode/unit combination (${options.mode}, ${unit})`,
        );
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

    // ctrl is the mountTimeSeriesCard handle; the legend toggle closure
    // below calls it on click, by which point it is assigned.
    let ctrl;
    const legend = createChartLegend({
        entries: seriesWithLabels(seriesInReadingOrder(options.mode)),
        hidden: state.hidden,
        onToggle: (key) => {
            if (state.hidden.has(key)) state.hidden.delete(key);
            else state.hidden.add(key);
            ctrl?.rerender();
        },
    });

    ctrl = mountTimeSeriesCard(parent, {
        title: preset.title,
        // The active drift currency rides next to the label so the
        // reader can never mistake a coverage view for an entry view;
        // flipping it (IPv4 <-> IPv6) rebuilds the header.
        subtitle: preset.unitLabel,
        info: preset.info,
        infoAria: preset.infoAria,
        cardClass: "drift-chart",
        legend,
        drawPlot: ({ width, height, layout }) =>
            buildChart(
                sortedMaps,
                computePoints(sortedMaps, diffs, options.mode, unit),
                options.mode,
                preset.family,
                preset.unitCountSuffix,
                state.hidden,
                preset.ariaLabel,
                width,
                height,
                layout,
                options,
            ),
    });
}

// ---- Chart assembly ---------------------------------------------

function buildChart(
    sortedMaps,
    points,
    mode,
    family,
    unitCountSuffix,
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
                rows: driftHoverRows(
                    points[slotIndex],
                    seriesWithLabels(seriesInReadingOrder(mode)),
                    mode,
                    family,
                    unitCountSuffix,
                ),
                footer: driftFooter(
                    points[slotIndex],
                    mode,
                    sortedMaps[slotIndex].released_at,
                ),
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
