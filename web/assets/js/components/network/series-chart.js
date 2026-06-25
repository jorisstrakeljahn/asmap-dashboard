// Generic multi-series time-series card for the Network tab.
//
// Decay, AS concentration, NetGroup diversity, bucketing, and the
// ASN cross-check all plot one line per series over a shared timeline,
// differing only in value accessor, y formatter, and tooltip copy.
// This module hosts the card chrome (header + lede + legend)
// and delegates the plot to the shared buildLineChart scaffold; each
// chart shrinks to a config object.
//
// Series are toggleable: clicking a legend entry hides its line and
// rescales the y domain to what stays visible, so a reader can isolate
// one source without the other compressing the axis.

import { mountTimeSeriesCard } from "../../charts/chart-card.js";
import { buildTooltipBody } from "../../charts/chart-tooltip.js";
import { buildLineChart } from "../../charts/line-chart.js";
import { mutedNote } from "../../utils/dom.js";
import { t } from "../../utils/i18n.js";
import { createChartLegend } from "../chart-legend.js";

// Fraction of the data range left as breathing room above and below
// the plotted lines so the extreme dots never sit on the card edge.
const Y_PADDING_FRACTION = 0.1;

export function mountSeriesChart(parent, config) {
    if (!parent) return;
    const {
        title,
        lede,
        ariaLabel,
        timestamps,
        series,
        valueAt,
        yFormat,
        yFloorZero = false,
        // Hard ceiling for the y domain. A share-of-total series like
        // coverage can never exceed 100, so padding the domain past it
        // would draw a misleading "102%" gridline.
        yCeil = null,
        emptyMessage,
        tooltipTitleAt,
        tooltipRowsAt,
        domainStart = null,
        domainEnd = null,
        // Optional element rendered in the card header next to the
        // title (e.g. a per-chart mode switch). Built by the caller
        // so this module stays agnostic of what the control does.
        headerExtra = null,
        // Series with no line in this view, listed greyed in the legend
        // with a reason on hover instead of vanishing. Shape:
        // { key, label, swatchClass, title }.
        unavailableSeries = [],
        // Pass-through to buildLineChart: a non-calendar x axis
        // (numeric domain + caller-supplied ticks). See line-chart.js.
        linearDomain = false,
        xTicks = null,
        state = { hidden: new Set() },
    } = config;

    if (!state.hidden) state.hidden = new Set();

    if (!Array.isArray(timestamps) || timestamps.length === 0) {
        parent.replaceChildren(mutedNote(emptyMessage ?? t("network.empty")));
        return;
    }

    // ctrl is the mountTimeSeriesCard handle; the legend toggle closure
    // below calls it on click, by which point it is assigned.
    let ctrl;
    const legend = createChartLegend({
        entries: series.map((s) => ({
            key: s.key,
            label: s.label,
            swatchClass: s.swatchClass,
        })),
        hidden: state.hidden,
        onToggle: (key) => {
            if (state.hidden.has(key)) state.hidden.delete(key);
            else state.hidden.add(key);
            ctrl?.rerender();
        },
        unavailable: unavailableSeries,
    });

    ctrl = mountTimeSeriesCard(parent, {
        title,
        lede,
        headerExtra,
        legend,
        drawPlot: ({ width, height, layout }) =>
            drawPlot(
                {
                    timestamps,
                    series,
                    valueAt,
                    yFormat,
                    yFloorZero,
                    yCeil,
                    ariaLabel,
                    tooltipTitleAt,
                    tooltipRowsAt,
                    domainStart,
                    domainEnd,
                    linearDomain,
                    xTicks,
                    hidden: state.hidden,
                },
                width,
                height,
                layout,
            ),
    });
}

function drawPlot(spec, width, height, layout) {
    const visibleSeries = spec.series.filter((s) => !spec.hidden.has(s.key));
    if (visibleSeries.length === 0) {
        return mutedNote(t("network.allSeriesHidden"));
    }

    const bounds = yBounds(spec, visibleSeries);
    if (bounds == null) {
        return mutedNote(t("network.noData"));
    }

    return buildLineChart(
        {
            timestamps: spec.timestamps,
            visibleSeries,
            valueAt: spec.valueAt,
            yMin: bounds.min,
            yMax: bounds.max,
            yFormat: spec.yFormat,
            yTitle: null,
            linearDomain: spec.linearDomain,
            xTicks: spec.xTicks,
            ariaLabel: spec.ariaLabel,
            tooltipBodyAt: (i) =>
                buildTooltipBody({
                    title: spec.tooltipTitleAt(i),
                    rows: spec.tooltipRowsAt(i, spec.hidden),
                }),
        },
        width,
        height,
        layout,
        { domainStart: spec.domainStart, domainEnd: spec.domainEnd },
    );
}

// y domain from the visible series only, padded so the extreme dots
// stay off the card border. A flat series (range 0) falls back to
// +/- one unit so the single line sits centred instead of clipped.
// ``yCeil`` clamps the padded top: a percentage-of-total series
// stops exactly at 100 instead of inventing headroom above it.
function yBounds(spec, visibleSeries) {
    let min = null;
    let max = null;
    for (const series of visibleSeries) {
        for (let i = 0; i < spec.timestamps.length; i++) {
            const value = spec.valueAt(series.key, i);
            if (value == null) continue;
            if (min == null || value < min) min = value;
            if (max == null || value > max) max = value;
        }
    }
    if (min == null) return null;
    const range = max - min;
    const pad = range > 0 ? range * Y_PADDING_FRACTION : 1;
    const paddedMax = max + pad;
    return {
        min: spec.yFloorZero ? Math.max(0, min - pad) : min - pad,
        max: spec.yCeil != null ? Math.min(spec.yCeil, paddedMax) : paddedMax,
    };
}
