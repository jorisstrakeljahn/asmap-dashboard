// Smoothed line chart of file_size_bytes over time. Hover anywhere
// over the chart to pin the nearest build and read its size +
// entry count in the tooltip.

import {
    areaPath,
    linearScale,
    niceTicks,
    smoothPath,
    svg,
} from "../charts/svg.js";
import {
    labelDensityForWidth,
    mountResponsiveChart,
    pickAxisLabelIndices,
    plotBounds,
    renderXAxis,
    renderYAxis,
} from "../charts/chart-base.js";
import {
    clientToSvg,
    createChartShell,
    hideTooltip,
    nearestIndex,
    placeTooltipNextFrame,
    showTooltip,
} from "../charts/chart-interaction.js";
import { buildTooltipBody } from "../charts/chart-tooltip.js";
import { formatDate, formatNumber, shortDate } from "../format.js";

const DOT_RADIUS = 3;
// Hover tolerance: how far past the plot bounds we still treat
// the cursor as "over the chart". Keeps the tooltip from
// flickering off when the mouse grazes the gutter.
const HOVER_BLEED = 12;

export function mount(parent, maps) {
    if (!parent) return;
    if (maps.length < 2) {
        parent.replaceChildren();
        return;
    }
    mountResponsiveChart(parent, {
        title: "Map Size Over Time",
        draw: ({ width, height, layout }) =>
            buildChart(maps, width, height, layout),
    });
}

function buildChart(maps, width, height, layout) {
    const plot = plotBounds(width, height, layout);

    const sizes = maps.map((m) => m.file_size_bytes);
    const yTicks = niceTicks(Math.min(...sizes), Math.max(...sizes));
    const yScale = linearScale([yTicks[0], yTicks.at(-1)], [plot.bottom, plot.top]);
    const xScale = linearScale([0, maps.length - 1], [plot.left, plot.right]);
    const xAt = (i) => xScale(i);

    const root = svg("svg", {
        viewBox: `0 0 ${width} ${height}`,
        class: "chart",
        role: "presentation",
    });
    root.setAttribute(
        "aria-label",
        "ASmap file size over time; hover the chart for exact values per build",
    );

    renderYAxis(root, yTicks, yScale, {
        plotLeft: plot.left,
        plotRight: plot.right,
        format: (tick) => `${(tick / 1e6).toFixed(2)}M`,
    });
    renderXAxis(
        root,
        pickAxisLabelIndices(maps.length, labelDensityForWidth(width)),
        xAt,
        plot.bottom,
        (i) => shortDate(maps[i].released_at),
    );

    const points = maps.map((m, i) => [xAt(i), yScale(m.file_size_bytes)]);

    root.append(
        svg("path", { d: areaPath(points, plot.bottom), class: "chart__area" }),
        svg("path", { d: smoothPath(points), class: "chart__line" }),
    );

    const cursorLine = svg("line", {
        x1: plot.left,
        x2: plot.left,
        y1: plot.top,
        y2: plot.bottom,
        class: "chart__cursor-line",
        visibility: "hidden",
    });
    root.append(cursorLine);

    for (let i = 0; i < maps.length; i++) {
        root.append(
            svg("circle", {
                cx: xAt(i),
                cy: yScale(maps[i].file_size_bytes),
                r: DOT_RADIUS,
                class: "chart__dot",
            }),
        );
    }

    const { shell, tip } = createChartShell(root);

    function hideHover() {
        hideTooltip(tip);
        cursorLine.setAttribute("visibility", "hidden");
    }

    function showHover(idx, ev) {
        const m = maps[idx];
        const x = xAt(idx);
        cursorLine.setAttribute("x1", String(x));
        cursorLine.setAttribute("x2", String(x));
        cursorLine.setAttribute("visibility", "visible");
        showTooltip(
            tip,
            buildTooltipBody({
                title: formatDate(m.released_at),
                rows: [
                    ["File size", `${formatNumber(m.file_size_bytes)} bytes`],
                    ["Entries", formatNumber(m.entries_count)],
                ],
                footer: m.name,
            }),
        );
        placeTooltipNextFrame(shell, tip, ev.clientX, ev.clientY);
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
            hideHover();
            return;
        }
        showHover(nearestIndex(pt.x, maps.length, xAt), ev);
    });
    shell.addEventListener("mouseleave", hideHover);

    return shell;
}
