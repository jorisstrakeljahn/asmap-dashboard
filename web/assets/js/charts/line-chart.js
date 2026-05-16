// Shared time-series line chart. Both the map size chart and the
// drift chart used to carry a near-identical buildChart() — same
// geometry, axes, line and dot drawing, and hover handling, only
// the data shape, the y formatter, and the tooltip body differed.
// This module hosts the common scaffold so each chart shrinks to
// its own SERIES definition, value accessor, and tooltip builder.
//
// The scaffold is pure rendering: it does not own state, does not
// render the legend or header, and does not decide what counts as
// an empty state. Callers handle all of that before invoking it
// and pass the already-filtered visible series. This keeps the
// scaffold reusable and the callers in charge of the storyboard.

import { linearScale, niceTicks, smoothPath, svg } from "./svg.js";
import {
    createChartSvg,
    labelDensityForWidth,
    pickTimeAxisTicks,
    plotBounds,
    renderTimeAxis,
    renderYAxis,
    renderYAxisTitle,
    resolveTimeDomain,
} from "./chart-base.js";
import {
    clientToSvg,
    createChartShell,
    hideTooltip,
    nearestIndex,
    placeTooltipNextFrame,
    showTooltip,
} from "./chart-interaction.js";

const DOT_RADIUS = 3;
// Hover tolerance: how far past the plot bounds we still treat
// the cursor as "over the chart". Keeps the tooltip from
// flickering off when the mouse grazes the gutter.
const HOVER_BLEED = 12;

// Render a time-series line chart and return its hover shell.
//
//   - ``timestamps``: one millisecond timestamp per x-axis slot,
//     in chronological order. ``timestamps.length`` defines the
//     slot count for every other parameter.
//   - ``visibleSeries``: the series the caller has decided should
//     be drawn. Each entry needs at least ``key``, ``lineClass``,
//     and ``dotClass``. Hidden series do not appear here, but the
//     caller is free to keep them inside ``tooltipBodyAt``.
//   - ``valueAt(seriesKey, slotIndex)``: returns the y value for
//     that pair, or ``null`` for a gap. Gaps break the line and
//     skip the dot so a missing build never bridges toward zero.
//   - ``yMin`` / ``yMax``: the y domain the caller wants. niceTicks
//     extends this to a tick-friendly range. Letting the caller
//     pass exact bounds keeps domain quirks (drift forcing min=0,
//     a 1 % floor for flat-zero plots) at the caller's side.
//   - ``yFormat`` / ``yTitle``: y tick formatter and the rotated
//     gutter label.
//   - ``ariaLabel``: aria-label on the SVG root.
//   - ``tooltipBodyAt(slotIndex)``: returns the rendered tooltip
//     body for the slot the cursor is closest to. The caller owns
//     the row layout, footer text, and any per-mode wording.
//   - ``options.domainStart`` / ``options.domainEnd``: optional
//     calendar overrides passed through to resolveTimeDomain so
//     the chart can span beyond the data (range picker windows).
export function buildLineChart(spec, width, height, layout, options = {}) {
    const geometry = computeGeometry(spec, width, height, layout, options);
    const root = createChartSvg(width, height, spec.ariaLabel);

    drawAxes(root, geometry, spec, width);
    drawSeriesLines(root, geometry, spec);
    drawSeriesDots(root, geometry, spec);

    return attachHover(root, geometry, spec);
}

// Single computation of plot bounds, axis ticks, and the two
// scales every sub-pass needs. Centralised so the y ticks the axis
// renders are guaranteed to match the y scale the lines and dots
// are positioned with.
function computeGeometry(spec, width, height, layout, options) {
    const plot = plotBounds(width, height, layout);
    const yTicks = niceTicks(spec.yMin, spec.yMax);
    const yScale = linearScale(
        [yTicks[0], yTicks.at(-1)],
        [plot.bottom, plot.top],
    );
    const { domainStart, domainEnd } = resolveTimeDomain(
        spec.timestamps,
        options,
    );
    const xScale = linearScale(
        [domainStart, domainEnd],
        [plot.left, plot.right],
    );
    return {
        plot,
        yTicks,
        yScale,
        xScale,
        domainStart,
        domainEnd,
        slotCount: spec.timestamps.length,
        xAt: (i) => xScale(spec.timestamps[i]),
    };
}

function drawAxes(root, geometry, spec, width) {
    const { plot, yTicks, yScale, xScale, domainStart, domainEnd } = geometry;
    renderYAxis(root, yTicks, yScale, {
        plotLeft: plot.left,
        plotRight: plot.right,
        format: spec.yFormat,
    });
    if (spec.yTitle) renderYAxisTitle(root, spec.yTitle, plot);
    const ticks = pickTimeAxisTicks(
        domainStart,
        domainEnd,
        labelDensityForWidth(width),
    );
    renderTimeAxis(root, ticks, xScale, plot.bottom);
}

// One smooth path per visible series, broken into sub-segments at
// every null returned by ``valueAt``. Breaking on null keeps the
// curve from ramping toward a phantom zero across a gap.
function drawSeriesLines(root, { xAt, yScale, slotCount }, spec) {
    for (const series of spec.visibleSeries) {
        for (const segment of contiguousSegments(spec, series, slotCount, xAt, yScale)) {
            root.append(
                svg("path", {
                    d: smoothPath(segment),
                    class: `chart__line ${series.lineClass}`,
                }),
            );
        }
    }
}

function drawSeriesDots(root, { xAt, yScale, slotCount }, spec) {
    for (const series of spec.visibleSeries) {
        for (let i = 0; i < slotCount; i++) {
            const value = spec.valueAt(series.key, i);
            if (value == null) continue;
            root.append(
                svg("circle", {
                    cx: xAt(i),
                    cy: yScale(value),
                    r: DOT_RADIUS,
                    class: `chart__dot ${series.dotClass}`,
                }),
            );
        }
    }
}

// Walk the slot index range and collect [x, y] pairs into
// contiguous segments, breaking wherever ``valueAt`` returns null.
// Each segment is rendered by its own smoothPath() call so the
// curve breaks at the gap instead of bridging it.
function contiguousSegments(spec, series, slotCount, xAt, yScale) {
    const segments = [];
    let current = [];
    for (let i = 0; i < slotCount; i++) {
        const value = spec.valueAt(series.key, i);
        if (value == null) {
            if (current.length >= 2) segments.push(current);
            current = [];
            continue;
        }
        current.push([xAt(i), yScale(value)]);
    }
    if (current.length >= 2) segments.push(current);
    return segments;
}

function attachHover(root, geometry, spec) {
    const { plot, xAt, slotCount } = geometry;
    const cursorLine = svg("line", {
        x1: plot.left,
        x2: plot.left,
        y1: plot.top,
        y2: plot.bottom,
        class: "chart__cursor-line",
        visibility: "hidden",
    });
    root.append(cursorLine);

    const { shell, tip } = createChartShell(root);

    const hide = () => {
        hideTooltip(tip);
        cursorLine.setAttribute("visibility", "hidden");
    };

    const show = (idx, ev) => {
        const x = xAt(idx);
        cursorLine.setAttribute("x1", String(x));
        cursorLine.setAttribute("x2", String(x));
        cursorLine.setAttribute("visibility", "visible");
        showTooltip(tip, spec.tooltipBodyAt(idx));
        placeTooltipNextFrame(shell, tip, ev.clientX, ev.clientY);
    };

    shell.addEventListener("mousemove", (ev) => {
        const pt = clientToSvg(root, ev.clientX, ev.clientY);
        if (!pt) return;
        if (
            pt.x < plot.left - HOVER_BLEED ||
            pt.x > plot.right + HOVER_BLEED ||
            pt.y < plot.top ||
            pt.y > plot.bottom
        ) {
            hide();
            return;
        }
        show(nearestIndex(pt.x, slotCount, xAt), ev);
    });
    shell.addEventListener("mouseleave", hide);

    return shell;
}
