// Shared time-series line chart for the map size and drift charts,
// which share geometry, axes, line/dot drawing, and hover handling —
// only the data shape, y formatter, and tooltip body differ. Each
// chart is then just its own SERIES definition, value accessor, and
// tooltip builder.
//
// The scaffold is pure rendering: no state, no legend/header, no
// empty-state decision. Callers handle that and pass the already-
// filtered visible series.

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
    createReadout,
    HOVER_BLEED,
    nearestIndexAmong,
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
//   - ``valueAt(seriesKey, slotIndex)``: y value for that pair, or
//     ``null`` for a gap. Gap slots get no dot and are skipped by
//     the line pass so the curve connects across them; the tooltip
//     still names the slot, so the bridge is a visual aid, not a
//     claim of data.
//   - ``yMin`` / ``yMax``: the y domain; niceTicks extends it to a
//     tick-friendly range. Exact bounds keep domain quirks (drift
//     forcing min=0, a 1 % floor for flat-zero plots) caller-side.
//   - ``yFormat`` / ``yTitle``: y tick formatter and gutter label.
//   - ``ariaLabel``: aria-label on the SVG root.
//   - ``tooltipBodyAt(slotIndex)``: rendered tooltip body for the
//     nearest slot. The caller owns row layout, footer, and wording.
//   - ``options.domainStart`` / ``options.domainEnd``: optional
//     calendar overrides for resolveTimeDomain so the chart can span
//     beyond the data (range picker windows).
//   - ``spec.linearDomain`` / ``spec.xTicks``: opt the x axis out of
//     calendar semantics. ``linearDomain`` uses the raw numeric
//     extent (no month snapping) and ``xTicks`` —
//     ``{ timestamp, label }[]`` in that space — replaces the
//     calendar ticks. Used by the decay chart's map-age view, where
//     x is days of map age, not a date.
export function buildLineChart(spec, width, height, layout, options = {}) {
    const geometry = computeGeometry(spec, width, height, layout, options);
    const root = createChartSvg(width, height, spec.ariaLabel);

    drawAxes(root, geometry, spec, width);
    drawSeriesLines(root, geometry, spec);
    drawSeriesDots(root, geometry, spec);

    return attachHover(root, geometry, spec, width);
}

// Single computation of plot bounds, axis ticks, and the two scales
// every sub-pass needs, so the rendered y ticks always match the y
// scale positioning lines and dots.
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
// returns null) are skipped so the line connects across them. The
// dot pass keeps gap slots dot-less and the tooltip still names
// them, so the bridge is a visual aid, not a claim of data.
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

// Collect the [x, y] points for one series in plot order, skipping
// null slots so smoothPath draws one curve gliding over the gap
// rather than two broken segments.
function seriesLinePoints(spec, series, slotCount, xAt, yScale) {
    const points = [];
    for (let i = 0; i < slotCount; i++) {
        const value = spec.valueAt(series.key, i);
        if (value == null) continue;
        points.push([xAt(i), yScale(value)]);
    }
    return points;
}

// Last slot where any visible series has a value, so the docked
// readout's idle state lands on the most recent real point, not a
// trailing gap. Returns -1 when nothing is plotted.
function lastSlotWithData(spec, slotCount) {
    for (let i = slotCount - 1; i >= 0; i--) {
        for (const series of spec.visibleSeries) {
            if (spec.valueAt(series.key, i) != null) return i;
        }
    }
    return -1;
}

// Every slot a pointer may land on: those where at least one visible
// series carries a value. A build with no diff drops out, so hover,
// touch, and keyboard all snap to the nearest real point.
function selectableSlots(spec, slotCount) {
    const slots = [];
    for (let i = 0; i < slotCount; i++) {
        for (const series of spec.visibleSeries) {
            if (spec.valueAt(series.key, i) != null) {
                slots.push(i);
                break;
            }
        }
    }
    return slots;
}

function attachHover(root, geometry, spec, width) {
    const { plot, xAt, yScale, slotCount } = geometry;
    const cursorLine = svg("line", {
        x1: plot.left,
        x2: plot.left,
        y1: plot.top,
        y2: plot.bottom,
        class: "chart__cursor-line",
        visibility: "hidden",
    });
    root.append(cursorLine);

    // One emphasized marker per visible series, hidden until a slot is
    // active. It rides the cursor line so the reader sees which point
    // on which line the reading refers to. Drawn after the base dots
    // so it sits on top.
    const markers = spec.visibleSeries.map((series) => {
        const dot = svg("circle", {
            r: DOT_RADIUS + 2,
            class: `chart__marker ${series.dotClass}`,
            visibility: "hidden",
        });
        root.append(dot);
        return { series, dot };
    });

    const { shell, tip, readout } = createChartShell(root);
    const ctrl = createReadout(shell, tip, readout, width);

    // Slots a pointer/keyboard may rest on. Empty builds are absent,
    // so the cursor snaps to the nearest real point instead.
    const selectable = selectableSlots(spec, slotCount);

    // Paint the cursor line and per-series markers for a slot. Markers
    // for a gap (no value here) stay hidden so the chart never claims
    // a point it didn't draw.
    const paintCursor = (idx) => {
        const x = xAt(idx);
        cursorLine.setAttribute("x1", String(x));
        cursorLine.setAttribute("x2", String(x));
        cursorLine.setAttribute("visibility", "visible");
        for (const { series, dot } of markers) {
            const value = spec.valueAt(series.key, idx);
            if (value == null) {
                dot.setAttribute("visibility", "hidden");
                continue;
            }
            dot.setAttribute("cx", String(x));
            dot.setAttribute("cy", String(yScale(value)));
            dot.setAttribute("visibility", "visible");
        }
    };

    const clearCursor = () => {
        cursorLine.setAttribute("visibility", "hidden");
        for (const { dot } of markers) dot.setAttribute("visibility", "hidden");
    };

    const show = (idx, clientX, clientY) => {
        paintCursor(idx);
        ctrl.present(() => spec.tooltipBodyAt(idx), clientX, clientY);
    };

    // On touch the readout strip stays populated, so its reserved
    // space never collapses and updates never shift the chart. At rest
    // it shows the latest data point; dismissing a scrub reverts to
    // that. The crosshair only appears while a slot is active.
    const idleIdx = lastSlotWithData(spec, slotCount);
    const showIdle = () => {
        clearCursor();
        if (ctrl.docked && idleIdx >= 0) {
            ctrl.present(() => spec.tooltipBodyAt(idleIdx));
        } else {
            ctrl.clear();
        }
    };
    const hide = showIdle;
    if (ctrl.docked && idleIdx >= 0) {
        ctrl.present(() => spec.tooltipBodyAt(idleIdx));
    }

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
        const idx = nearestIndexAmong(pt.x, selectable, xAt);
        if (idx < 0) {
            hide();
            return;
        }
        show(idx, ev.clientX, ev.clientY);
    });
    shell.addEventListener("mouseleave", hide);

    // Touch resolves on the x axis only: a finger lands anywhere in a
    // column, not on the 3 px dot, so the mouse path's y-band check
    // would make most taps miss. Off-plot x dismisses.
    attachTouchInspect(shell, {
        resolve: (clientX, clientY) => {
            const pt = clientToSvg(root, clientX, clientY);
            if (!pt) return null;
            if (pt.x < plot.left - HOVER_BLEED || pt.x > plot.right + HOVER_BLEED) {
                return null;
            }
            const idx = nearestIndexAmong(pt.x, selectable, xAt);
            return idx < 0 ? null : idx;
        },
        show,
        hide,
    });

    attachKeyboardInspect(shell, { slots: selectable, show, hide, xAt });

    return shell;
}
