// Shared stacked time-series bar chart. Sister scaffold to
// line-chart.js: same axes, hover plumbing, and gap handling, but
// every slot renders as a vertical bar split into segments instead
// of a curve. Kept separate because the rendering passes differ
// enough (a rectangle per (series, slot) vs a path) that branching
// inside line-chart.js would obscure both paths.
//
// Stack order follows the SERIES order: first series at the bottom,
// last on top. The total stack height per slot is the sum of its
// visible-series values, so a "total = bar height" reading needs no
// separate series.

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
    attachKeyboardInspect,
    attachTouchInspect,
    clientToSvg,
    createChartShell,
    createReadout,
    HOVER_BLEED,
    isTooltipVisible,
    nearestIndexAmong,
    positionTooltip,
} from "./chart-interaction.js";
import { BAR_CORNER_RADIUS, pickBarWidth } from "./bar-geometry.js";

// Only the outer corners of the *whole stack* round (in drawStacks
// via BAR_CORNER_RADIUS). Middle segments stay square so the eye
// reads the stack as one bar with several colours, not stacked pills.

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
//   - ``valueAt(seriesKey, slotIndex)``: y value for that (series,
//     slot) pair, or ``null`` for a gap. A slot where every visible
//     series returns null renders as no bar, so a build with no
//     comparable diff is visibly empty.
//   - ``yMin`` / ``yMax``: the y domain. ``yMin`` is typically 0 for
//     share / ratio data; niceTicks extends ``yMax`` to a
//     tick-friendly upper bound.
//   - ``yFormat`` / ``yTitle``: y tick formatter and gutter label.
//   - ``ariaLabel``: aria-label on the SVG root.
//   - ``tooltipBodyAt(slotIndex)``: rendered tooltip body for the
//     slot under the cursor. Same shape as the line-chart scaffold
//     so components can share builders.
//   - ``options.domainStart`` / ``options.domainEnd``: optional
//     calendar overrides for resolveTimeDomain so the chart can span
//     beyond the data (range picker windows).
export function buildStackedBarChart(spec, width, height, layout, options = {}) {
    const geometry = computeGeometry(spec, width, height, layout, options);
    const root = createChartSvg(width, height, spec.ariaLabel);

    drawAxes(root, geometry, spec, width);
    const groups = drawStacks(root, geometry, spec);
    return attachHover(root, geometry, spec, groups, width);
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

// One <g> per slot holding that slot's visible-series paths.
// Returning the groups lets the hover layer flip an active class on
// the whole stack at once, matching the map-delta chart's single-bar
// affordance.
//
// The stack walks bottom-to-top in spec.visibleSeries order. Heights
// come from the linear yScale: ``yScale(0) - yScale(value)`` is the
// pixel span of ``value`` units, subtracted from the running cursor
// to find each segment's top (SVG y grows downward).
//
// Two passes per slot: the first collects surviving segments so we
// know which sits on the baseline and which is on top; the second
// draws each as a path, rounding only the stack's outer corners
// (never between segments). A lone segment rounds both sides.
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

// First pass: walk the visible series for one slot, drop the ones
// that contribute nothing, and emit { series, top, height } in
// baseline-to-top order. Heights are floored at 1 px so a sliver
// still paints rather than vanishing.
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

// Build an SVG ``d`` string for a rectangle whose four corners can
// independently round or stay square. SVG ``rect rx=…`` only allows
// a uniform radius, so a stack rounding just its outer corners must
// use a path. Walks clockwise from the top-left, emitting an arc
// only where the radius is > 0; square corners reuse H / V. Radii
// are clamped to half the smaller dimension so a short slot can't
// get a corner that inverts the geometry.
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

// Hover: an invisible full-height capture strip per slot catches the
// cursor anywhere in the column, not just inside a drawn segment,
// keeping the tooltip stable when a stack is small or a series is
// hidden. The matching ``group`` flips an active class so the
// segments fade to the chart-bar--active accent tone.
function attachHover(root, geometry, spec, groups, width) {
    const { plot, xAt, barWidth, slotCount } = geometry;
    const { shell, tip, readout } = createChartShell(root);
    const ctrl = createReadout(shell, tip, readout, width);

    // Only columns that drew a stack are selectable; a null group (no
    // comparable diff) is skipped so the cursor snaps to the nearest
    // real bar.
    const selectable = groups.flatMap((group, i) => (group ? [i] : []));

    let activeGroup = null;
    const clearActive = () => {
        if (activeGroup) {
            activeGroup.classList.remove("chart__stack--active");
            activeGroup = null;
        }
    };

    // Shared by the mouse capture and touch path so a tap highlights
    // the same stack and tooltip a hover would.
    const showSlot = (slotIndex, clientX, clientY) => {
        clearActive();
        const group = groups[slotIndex];
        if (group) {
            group.classList.add("chart__stack--active");
            activeGroup = group;
        }
        ctrl.present(() => spec.tooltipBodyAt(slotIndex), clientX, clientY);
    };

    // On touch the readout strip stays populated with the latest
    // column at rest, so the reserved space never collapses and
    // updates never shift the chart. The active-stack highlight only
    // appears while a slot is engaged.
    const idleIdx = lastSlotWithStack(groups);
    const hide = () => {
        clearActive();
        if (ctrl.docked && idleIdx >= 0) {
            ctrl.present(() => spec.tooltipBodyAt(idleIdx));
        } else {
            ctrl.clear();
        }
    };
    if (ctrl.docked && idleIdx >= 0) {
        ctrl.present(() => spec.tooltipBodyAt(idleIdx));
    }

    for (let i = 0; i < slotCount; i++) {
        // No stack here: leave the column without a capture strip so
        // it can't be hovered.
        if (!groups[i]) continue;
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
    // requiring a finger to land inside one strip.
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
        show: showSlot,
        hide,
    });

    attachKeyboardInspect(shell, { slots: selectable, show: showSlot, hide, xAt });

    return shell;
}

// Last slot that rendered a stack (a null group is a build with no
// comparable diff), so the docked readout's idle state lands on the
// most recent real column. Returns -1 when nothing is drawn.
function lastSlotWithStack(groups) {
    for (let i = groups.length - 1; i >= 0; i--) {
        if (groups[i]) return i;
    }
    return -1;
}
