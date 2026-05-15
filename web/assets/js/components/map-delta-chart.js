// Vertical bar chart of entry-count delta between consecutive
// builds, computed from the unfilled (source data) variant. A bar
// is the gain or loss in real source-data prefixes; positive
// deltas grow up from the baseline, negative down. Hover a bar
// for the exact "prev -> this" entries and signed delta.
//
// Builds without an unfilled variant cannot contribute a bar
// because the corresponding entry count is missing on either
// side; the chart silently skips them, matching the behaviour of
// the drift chart and pair-diff loop.

import { linearScale, niceTicks, svg } from "../charts/svg.js";
import {
    labelDensityForWidth,
    mountResponsiveChart,
    pickAxisLabelIndices,
    plotBounds,
    renderXAxis,
    renderYAxis,
} from "../charts/chart-base.js";
import {
    createChartShell,
    hideTooltip,
    isTooltipVisible,
    placeTooltipNextFrame,
    positionTooltip,
    showTooltip,
} from "../charts/chart-interaction.js";
import { buildTooltipBody } from "../charts/chart-tooltip.js";
import { formatDate, formatNumber, shortDate } from "../format.js";
import { unfilledProfile } from "../utils/variants.js";

const BAR_GAP = 12;
const MIN_BAR_WIDTH = 8;
const BAR_CORNER_RADIUS = 2;

export function mount(parent, maps) {
    if (!parent) return;
    const rows = deltasBetween(maps);
    if (rows.length < 1) {
        parent.replaceChildren();
        return;
    }
    mountResponsiveChart(parent, {
        title: "Source Data Entries Delta Between Consecutive Maps",
        draw: ({ width, height, layout }) =>
            buildChart(rows, width, height, layout),
    });
}

// Pre-compute everything each bar will need so the render path
// never has to re-derive values from the raw map list. Walks
// every (previous, current) pair and emits one row when both
// sides expose an unfilled variant; pairs missing either side
// are dropped silently rather than rendered as a misleading bar.
function deltasBetween(maps) {
    const rows = [];
    for (let i = 1; i < maps.length; i++) {
        const previous = unfilledProfile(maps[i - 1]);
        const current = unfilledProfile(maps[i]);
        if (!previous || !current) continue;
        rows.push({
            released_at: maps[i].released_at,
            name: maps[i].name,
            entries: current.entries_count,
            prev_entries: previous.entries_count,
            delta: current.entries_count - previous.entries_count,
        });
    }
    return rows;
}

function buildChart(rows, width, height, layout) {
    const plot = plotBounds(width, height, layout);

    const values = rows.map((r) => r.delta);
    const yTicks = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
    const yScale = linearScale([yTicks[0], yTicks.at(-1)], [plot.bottom, plot.top]);

    const slotWidth = (plot.right - plot.left) / rows.length;
    const barWidth = Math.max(MIN_BAR_WIDTH, slotWidth - BAR_GAP);
    const xAt = (i) => plot.left + slotWidth * (i + 0.5);

    const root = svg("svg", {
        viewBox: `0 0 ${width} ${height}`,
        class: "chart",
        role: "presentation",
    });
    root.setAttribute(
        "aria-label",
        "Source-data entry count delta between consecutive ASmap builds; hover each bar for details",
    );

    renderYAxis(root, yTicks, yScale, {
        plotLeft: plot.left,
        plotRight: plot.right,
        format: formatTick,
    });

    // Zero baseline goes in before the bars so positive bars
    // cover it where they sit above zero, but it stays visible
    // where bars dip negative.
    const crossesZero = yTicks[0] < 0 && yTicks.at(-1) > 0;
    if (crossesZero) {
        const zeroY = yScale(0);
        root.append(
            svg("line", {
                x1: plot.left,
                x2: plot.right,
                y1: zeroY,
                y2: zeroY,
                class: "chart__zero",
            }),
        );
    }

    const { shell, tip } = createChartShell(root);
    const hide = () => hideTooltip(tip);

    rows.forEach((row, i) => {
        const top = yScale(Math.max(0, row.delta));
        const bottom = yScale(Math.min(0, row.delta));
        const bar = svg("rect", {
            x: xAt(i) - barWidth / 2,
            y: top,
            width: barWidth,
            height: Math.max(1, bottom - top),
            rx: BAR_CORNER_RADIUS,
            class: "chart__bar",
        });
        root.append(bar);

        bar.addEventListener("mouseenter", (ev) => {
            showTooltip(
                tip,
                buildTooltipBody({
                    title: formatDate(row.released_at),
                    rows: [
                        ["Delta", `${formatSignedDelta(row.delta)} entries`],
                        [
                            "Entries (prev \u2192 this)",
                            `${formatNumber(row.prev_entries)} \u2192 ${formatNumber(row.entries)}`,
                        ],
                    ],
                    footer: row.name,
                }),
            );
            placeTooltipNextFrame(shell, tip, ev.clientX, ev.clientY);
        });
        bar.addEventListener("mousemove", (ev) => {
            if (isTooltipVisible(tip)) {
                positionTooltip(shell, tip, ev.clientX, ev.clientY);
            }
        });
        bar.addEventListener("mouseleave", hide);
    });
    shell.addEventListener("mouseleave", hide);

    renderXAxis(
        root,
        pickAxisLabelIndices(rows.length, labelDensityForWidth(width)),
        xAt,
        plot.bottom,
        (i) => shortDate(rows[i].released_at),
    );

    return shell;
}

function formatSignedDelta(value) {
    return value > 0 ? `+${formatNumber(value)}` : formatNumber(value);
}

function formatTick(value) {
    const abs = Math.abs(value);
    return abs >= 1000 ? `${Math.round(value / 1000)}k` : String(value);
}
