// Shared stacked time-series bar chart. Sister scaffold to
// line-chart.js: same time-axis + y-axis geometry, same hover
// tooltip plumbing, same gap handling, but every slot renders as
// a vertical bar split into segments instead of a curve through
// points.
//
// Why a separate scaffold instead of "buildLineChart with a bar
// flag": the rendering passes are different enough (a single
// rectangle per (series, slot) instead of a path through points)
// that branching inside line-chart.js would obscure both code
// paths. The shared geometry stays in chart-base.js, and the two
// scaffolds remain readable on their own.
//
// Stack order is the SERIES order the caller passes: first series
// sits at the bottom, last on top. The total stack height per
// slot equals the sum of the slot's visible-series values, so
// callers that want a "total drift = bar height" reading don't
// need a separate series for it.

import { linearScale, niceTicks, svg } from "./svg.js";
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
    attachTouchInspect,
    clientToSvg,
    createChartShell,
    hideTooltip,
    isTooltipVisible,
    nearestIndex,
    placeTooltipNextFrame,
    positionTooltip,
    showTooltip,
} from "./chart-interaction.js";
import {
    BAR_CORNER_RADIUS,
    HOVER_BLEED,
    pickBarWidth,
} from "./bar-geometry.js";

// Only the outer corners of the *whole stack* round (handled in
// drawStacks via BAR_CORNER_RADIUS). Middle segments keep square
// edges so the eye reads a stack of three segments as one bar with
// three colours, not three pills stacked on top of each other.

// Render a stacked time-series bar chart and return its hover shell.
//
//   - ``timestamps``: one millisecond timestamp per x-axis slot,
//     in chronological order. ``timestamps.length`` defines the
//     slot count for every other parameter.
//   - ``visibleSeries``: the series the caller has decided should
//     be drawn. Each entry needs at least ``key`` and
//     ``barClass``. Bottom-to-top stack order follows the array
//     order. Hidden series are absent here; the caller is free
//     to keep them inside ``tooltipBodyAt``.
//   - ``valueAt(seriesKey, slotIndex)``: returns the y value for
//     that (series, slot) pair, or ``null`` for a gap. A slot
//     where every visible series returns null renders as no bar
//     at all so a build with no comparable diff is visibly empty.
//   - ``yMin`` / ``yMax``: the y domain the caller wants. ``yMin``
//     is typically 0 for share / ratio data; niceTicks then
//     extends ``yMax`` to a tick-friendly upper bound.
//   - ``yFormat`` / ``yTitle``: y tick formatter and the rotated
//     gutter label.
//   - ``ariaLabel``: aria-label on the SVG root.
//   - ``tooltipBodyAt(slotIndex)``: returns the rendered tooltip
//     body for the slot the cursor is over. Same shape as the
//     line-chart scaffold so chart components can share builders.
//   - ``options.domainStart`` / ``options.domainEnd``: optional
//     calendar overrides passed through to resolveTimeDomain so
//     the chart can span beyond the data (range picker windows).
export function buildStackedBarChart(spec, width, height, layout, options = {}) {
    const geometry = computeGeometry(spec, width, height, layout, options);
    const root = createChartSvg(width, height, spec.ariaLabel);

    drawAxes(root, geometry, spec, width);
    const groups = drawStacks(root, geometry, spec);
    return attachHover(root, geometry, spec, groups);
}

// Single computation of plot bounds, axis ticks, scales and the
// per-slot bar geometry. Shared between every sub-pass.
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
    const xAt = (i) => xScale(spec.timestamps[i]);
    const barWidth = pickBarWidth(spec.timestamps, xScale, plot);
    return {
        plot,
        yTicks,
        yScale,
        xScale,
        domainStart,
        domainEnd,
        slotCount: spec.timestamps.length,
        xAt,
        barWidth,
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

// One <g> per slot, holding every visible series' path for that
// slot. Returning the per-slot groups lets the hover layer flip
// an active class on the whole stack at once so the eye locks
// onto the column the tooltip describes — matching the single-bar
// hover affordance the map-delta chart uses.
//
// The stack walks bottom-to-top in spec.visibleSeries order, so
// the first series sits at the baseline and the last sits on
// top. Heights come from the linear yScale: ``yScale(0) -
// yScale(value)`` is the pixel span of ``value`` y-axis units,
// which we subtract from the running cursor to find each
// segment's top (SVG y grows downward).
//
// Each slot renders in two passes. The first pass collects the
// surviving segments so we know which one is logically at the
// bottom (sits on the baseline) and which one is at the top of
// the stack. The second pass then draws each segment as a path
// with corners rounded only on the outer edge of the whole
// stack, never between segments. A lone segment rounds both
// sides like a normal bar.
function drawStacks(root, geometry, spec) {
    const { yScale, xAt, barWidth, slotCount } = geometry;
    const baselineY = yScale(spec.yMin);
    const groups = [];
    for (let i = 0; i < slotCount; i++) {
        const segments = collectSegments(spec, geometry, baselineY, i);
        if (segments.length === 0) {
            groups.push(null);
            continue;
        }
        const group = svg("g", { class: "chart__stack" });
        const x = xAt(i) - barWidth / 2;
        const lastIndex = segments.length - 1;
        segments.forEach((seg, idx) => {
            const isBottom = idx === 0;
            const isTop = idx === lastIndex;
            group.append(
                svg("path", {
                    d: roundedRectPath(x, seg.top, barWidth, seg.height, {
                        tl: isTop ? BAR_CORNER_RADIUS : 0,
                        tr: isTop ? BAR_CORNER_RADIUS : 0,
                        br: isBottom ? BAR_CORNER_RADIUS : 0,
                        bl: isBottom ? BAR_CORNER_RADIUS : 0,
                    }),
                    class: `chart__bar ${seg.series.barClass}`,
                }),
            );
        });
        root.append(group);
        groups.push(group);
    }
    return groups;
}

// First pass: walk the visible series for one slot, drop the
// ones with no contribution to the stack, and emit { series,
// top, height } in baseline-to-top render order. Heights are
// floored at 1 px so a series that contributes a sliver still
// paints something rather than vanishing in a pixel-perfect
// floor.
function collectSegments(spec, geometry, baselineY, slotIndex) {
    const { yScale } = geometry;
    const segments = [];
    let cursorY = baselineY;
    for (const series of spec.visibleSeries) {
        const value = spec.valueAt(series.key, slotIndex);
        if (value == null || value <= 0) continue;
        const px = yScale(0) - yScale(value);
        const top = cursorY - px;
        segments.push({ series, top, height: Math.max(1, px) });
        cursorY = top;
    }
    return segments;
}

// Build an SVG ``d`` string for a rectangle whose four corners
// can independently round or stay square. SVG ``rect rx=…`` only
// supports a uniform radius, so the stacked bar — where only the
// outer corners of the whole stack should round — has to drop
// down to a path. The path walks clockwise from the top-left and
// emits an arc command only when the matching radius is > 0;
// straight corners reuse the H / V commands and read as crisp
// 90° turns. Radii are clamped to half the smaller dimension so
// a 2 px tall slot doesn't get a 2 px corner that would invert
// the geometry.
function roundedRectPath(x, y, w, h, radii) {
    const maxR = Math.min(w / 2, h / 2);
    const tl = Math.min(radii.tl, maxR);
    const tr = Math.min(radii.tr, maxR);
    const br = Math.min(radii.br, maxR);
    const bl = Math.min(radii.bl, maxR);
    const parts = [`M ${x + tl} ${y}`, `H ${x + w - tr}`];
    if (tr > 0) parts.push(`A ${tr} ${tr} 0 0 1 ${x + w} ${y + tr}`);
    parts.push(`V ${y + h - br}`);
    if (br > 0) parts.push(`A ${br} ${br} 0 0 1 ${x + w - br} ${y + h}`);
    parts.push(`H ${x + bl}`);
    if (bl > 0) parts.push(`A ${bl} ${bl} 0 0 1 ${x} ${y + h - bl}`);
    parts.push(`V ${y + tl}`);
    if (tl > 0) parts.push(`A ${tl} ${tl} 0 0 1 ${x + tl} ${y}`);
    parts.push("Z");
    return parts.join(" ");
}

// Hover: an invisible full-height capture strip per slot catches
// the cursor anywhere in the slot's column (not just inside a
// drawn segment), which keeps the tooltip stable when a slot's
// stack is small or when a series is hidden. The matching ``group``
// from drawStacks() flips an active class so the visible segments
// fade to the soft accent tone the chart-bar--active rule already
// supports.
function attachHover(root, geometry, spec, groups) {
    const { plot, xAt, barWidth, slotCount } = geometry;
    const { shell, tip } = createChartShell(root);

    let activeGroup = null;
    const clearActive = () => {
        if (activeGroup) {
            activeGroup.classList.remove("chart__stack--active");
            activeGroup = null;
        }
    };
    const hide = () => {
        hideTooltip(tip);
        clearActive();
    };

    // Shared by the per-slot mouse capture and the touch path so a
    // tap highlights the same stack and shows the same tooltip a
    // hover would.
    const showSlot = (slotIndex, clientX, clientY) => {
        clearActive();
        const group = groups[slotIndex];
        if (group) {
            group.classList.add("chart__stack--active");
            activeGroup = group;
        }
        showTooltip(tip, spec.tooltipBodyAt(slotIndex));
        placeTooltipNextFrame(shell, tip, clientX, clientY);
    };

    for (let i = 0; i < slotCount; i++) {
        const slotIndex = i;
        const capture = svg("rect", {
            x: xAt(i) - barWidth / 2,
            y: plot.top,
            width: barWidth,
            height: plot.bottom - plot.top,
            class: "chart__bar-capture",
        });
        root.append(capture);

        capture.addEventListener("mouseenter", (ev) => {
            showSlot(slotIndex, ev.clientX, ev.clientY);
        });
        capture.addEventListener("mousemove", (ev) => {
            if (isTooltipVisible(tip)) {
                positionTooltip(shell, tip, ev.clientX, ev.clientY);
            }
        });
        capture.addEventListener("mouseleave", hide);
    }
    shell.addEventListener("mouseleave", hide);

    // Touch maps to the nearest column by x: the capture strips are
    // narrow, so resolving against every slot is more forgiving than
    // relying on a finger landing inside one strip.
    attachTouchInspect(shell, {
        resolve: (clientX, clientY) => {
            const pt = clientToSvg(root, clientX, clientY);
            if (!pt) return null;
            if (pt.x < plot.left - HOVER_BLEED || pt.x > plot.right + HOVER_BLEED) {
                return null;
            }
            return nearestIndex(pt.x, slotCount, xAt);
        },
        show: showSlot,
        hide,
    });

    return shell;
}
