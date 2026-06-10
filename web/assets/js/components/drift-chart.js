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

import { mountResponsiveChart } from "../charts/chart-base.js";
import { buildTooltipBody } from "../charts/chart-tooltip.js";
import { buildLineChart } from "../charts/line-chart.js";
import { buildStackedBarChart } from "../charts/stacked-bar-chart.js";
import {
    FAMILY_IPV4,
    FAMILY_IPV6,
    familyUnitLabel,
    formatCoverage,
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
import { createInfoTooltip } from "./info-tooltip.js";

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

// ---- Card header (label, unit subtitle, info) -------------------

function buildHeader(preset) {
    const header = document.createElement("div");
    header.className = "drift-chart__header";

    const titleGroup = document.createElement("div");
    titleGroup.className = "drift-chart__title";

    const label = document.createElement("span");
    label.className = "card__label uppercase-label";
    label.textContent = preset.title.toUpperCase();
    titleGroup.append(label);

    // Subtitle calls out the currently active drift currency
    // right next to the card label, so the reader can never
    // mistake a coverage view for an entry view.
    const unit = document.createElement("span");
    unit.className = "drift-chart__unit muted";
    unit.textContent = preset.unitLabel;
    titleGroup.append(unit);

    header.append(titleGroup);

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
                rows: hoverRows(points[slotIndex], mode, family, unitCountSuffix),
                footer: footerFor(
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

// Reading order: cumulative leads with Total. Step surfaces it
// as a footer because the stack height already conveys it.
// Hidden series still show up. The tooltip is the inspection
// surface. The Total row appends a family aware count so the
// hover reading names what the percentage was computed against.
// IPv4 renders as raw addresses, IPv6 as /32 NetGroup blocks so
// the cell never grows into a 30 digit decimal that would push
// the tooltip past the chart edge.
function hoverRows(point, mode, family, unitCountSuffix) {
    const totalLabel = t("history.driftSeries.total");
    if (!point.present) {
        return [[totalLabel, t("history.driftSeries.noDiff")]];
    }
    const series = seriesWithLabels(seriesInReadingOrder(mode));
    const rows = series.map((s) => {
        const pct = formatPercent(s.accessor(point), 1);
        if (s.key === "total") {
            return [s.label, formatTotalCell(point, family, unitCountSuffix)];
        }
        return [s.label, pct];
    });
    if (mode === "step") {
        rows.push([totalLabel, formatTotalCell(point, family, unitCountSuffix)]);
    }
    return rows;
}

function formatTotalCell(point, family, unitCountSuffix) {
    return t("history.driftSeries.totalWithCount", {
        pct: formatPercent(point.total_ratio, 1),
        count: formatCoverage(point.total_changes, family),
        unit: unitCountSuffix,
    });
}

// Step mode names the gap to the compared build right in the footer:
// the bars are not time-normalised, so a tall bar after a five-month
// publishing pause is mostly accumulated time, not a routing event.
// Spelling out "147 days earlier" hands the reader the denominator
// they need to judge the bar's height.
function footerFor(point, mode, currentReleasedAt) {
    if (!point.present || !point.vs) return null;
    const date = formatDate(point.vs.released_at);
    if (mode === "cumulative") {
        return t("history.driftSeries.sinceDate", { date });
    }
    const days = gapDays(point.vs.released_at, currentReleasedAt);
    return days > 0
        ? t("history.driftSeries.vsDateWithGap", { date, days })
        : t("history.driftSeries.vsDate", { date });
}

function gapDays(fromIso, toIso) {
    const from = Date.parse(fromIso);
    const to = Date.parse(toIso);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
    return Math.max(0, Math.round((to - from) / 86_400_000));
}
