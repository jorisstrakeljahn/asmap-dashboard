// Shared time-series line chart for the map size chart and the
// drift chart, which need near-identical geometry, axes, line and
// dot drawing, and hover handling — only the data shape, the y
// formatter, and the tooltip body differ. This module hosts the
// common scaffold so each chart is just its own SERIES definition,
// value accessor, and tooltip builder.
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
    attachKeyboardInspect,
    attachTouchInspect,
    clientToSvg,
    createChartShell,
    HOVER_BLEED,
    hideTooltip,
    nearestIndex,
    placeTooltipNextFrame,
    showTooltip,
} from "./chart-interaction.js";

const DOT_RADIUS = 3;

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
//     that pair, or ``null`` for a gap. Gap slots get no dot and
//     are skipped by the line pass so the curve connects the
//     surrounding points instead of breaking. The hover tooltip
//     still names the slot, so the bridge is a visual aid, not a
//     claim of data.
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
//   - ``spec.linearDomain`` / ``spec.xTicks``: opt the x axis out of
//     calendar semantics. With ``linearDomain`` the domain is the
//     raw numeric extent (no month snapping) and ``xTicks`` —
//     ``{ timestamp, label }[]`` in the same numeric space — replaces
//     the calendar ticks. Used by the decay chart's map-age view,
//     where x is "days of map age", not a date.
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
    const { domainStart, domainEnd } = spec.linearDomain
        ? {
              domainStart: options.domainStart ?? spec.timestamps[0],
              domainEnd:
                  options.domainEnd ?? spec.timestamps[spec.timestamps.length - 1],
          }
        : resolveTimeDomain(spec.timestamps, options);
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
    // renderTimeAxis only positions { timestamp, label } pairs, so
    // caller-supplied numeric ticks reuse it unchanged.
    const ticks = spec.xTicks
        ?? pickTimeAxisTicks(domainStart, domainEnd, labelDensityForWidth(width));
    renderTimeAxis(root, ticks, xScale, plot.bottom);
}

// One smooth path per visible series. Missing slots (``valueAt``
// returns null) are skipped so the line connects the surrounding
// data points instead of breaking. The dot pass keeps gap slots
// dot-less and the hover tooltip still names them as "not
// published" / "no diff", so the bridge is a visual aid, not a
// claim of data.
function drawSeriesLines(root, { xAt, yScale, slotCount }, spec) {
    for (const series of spec.visibleSeries) {
        const points = seriesLinePoints(spec, series, slotCount, xAt, yScale);
        if (points.length < 2) continue;
        root.append(
            svg("path", {
                d: smoothPath(points),
                class: `chart__line ${series.lineClass}`,
            }),
        );
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

// Collect the [x, y] points for one series in plot order. Slots
// where ``valueAt`` returns null are skipped so the surrounding
// points connect directly. smoothPath then draws one curve that
// glides over the gap rather than two segments with a break.
function seriesLinePoints(spec, series, slotCount, xAt, yScale) {
    const points = [];
    for (let i = 0; i < slotCount; i++) {
        const value = spec.valueAt(series.key, i);
        if (value == null) continue;
        points.push([xAt(i), yScale(value)]);
    }
    return points;
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

    const show = (idx, clientX, clientY) => {
        const x = xAt(idx);
        cursorLine.setAttribute("x1", String(x));
        cursorLine.setAttribute("x2", String(x));
        cursorLine.setAttribute("visibility", "visible");
        showTooltip(tip, spec.tooltipBodyAt(idx));
        placeTooltipNextFrame(shell, tip, clientX, clientY);
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
        show(nearestIndex(pt.x, slotCount, xAt), ev.clientX, ev.clientY);
    });
    shell.addEventListener("mouseleave", hide);

    // Touch resolves on the x axis only: a finger lands anywhere in
    // a column, not on the 3 px dot, so the y-band check the mouse
    // path uses would make most taps miss. Off-plot x dismisses.
    attachTouchInspect(shell, {
        resolve: (clientX, clientY) => {
            const pt = clientToSvg(root, clientX, clientY);
            if (!pt) return null;
            if (pt.x < plot.left - HOVER_BLEED || pt.x > plot.right + HOVER_BLEED) {
                return null;
            }
            return nearestIndex(pt.x, slotCount, xAt);
        },
        show,
        hide,
    });

    attachKeyboardInspect(shell, { count: slotCount, show, hide, xAt });

    return shell;
}
