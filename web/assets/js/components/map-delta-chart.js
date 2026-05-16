// Vertical bar chart of entry-count delta between consecutive
// builds, computed from the unfilled (source data) variant. Each
// bar is the gain or loss in real source-data prefixes. Positive
// deltas grow up from the baseline, negative down. Hover a bar
// for the exact "prev to this" entries and signed delta.
//
// Builds without an unfilled variant cannot contribute a bar
// because the corresponding entry count is missing on either
// side. The chart silently skips them, matching the behaviour of
// the drift chart and pair-diff loop.

import { linearScale, niceTicks, svg } from "../charts/svg.js";
import {
    labelDensityForWidth,
    mountResponsiveChart,
    pickTimeAxisTicks,
    plotBounds,
    renderTimeAxis,
    renderYAxis,
    renderYAxisTitle,
    snapToMonthStart,
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
import { formatDate, formatNumber } from "../format.js";
import { unfilledProfile } from "../utils/variants.js";
import { createInfoTooltip } from "./info-tooltip.js";

// Bars sit at their build's real release timestamp instead of in
// uniformly spaced slots, so a 4-month publishing pause shows as
// a wide gap and a cluster of weekly builds shows as a cluster.
// Width is uniform so the eye doesn't read "fatter bar = bigger
// delta". The smallest neighbour gap drives the width so dense
// clusters never overlap and sparse periods don't render single
// builds as solid blocks.
const MIN_BAR_WIDTH = 3;
const MAX_BAR_WIDTH = 14;
const BAR_FILL_FRACTION = 0.7;
const BAR_CORNER_RADIUS = 2;

const MAP_DELTA_INFO = [
    "Gain or loss in source-data prefix entries between every pair of consecutive builds.",
    "A positive bar means the next build added that many real (prefix to ASN) entries on top of the previous one. A negative bar means entries fell out of the upstream data, typically because RPKI / IRR coverage retracted for some prefix.",
    "Computed from the unfilled (source data) variant of both sides. Pairs missing the unfilled variant on either side are skipped silently rather than rendered as a misleading bar.",
];

export function mount(parent, maps) {
    if (!parent || !Array.isArray(maps) || maps.length === 0) return;
    const rows = deltasBetween(maps);
    if (rows.length < 1) {
        parent.replaceChildren();
        return;
    }
    mountResponsiveChart(parent, {
        title: "Source Data Entries Delta Between Consecutive Maps",
        info: createInfoTooltip({
            body: MAP_DELTA_INFO,
            ariaLabel: "About the entries delta chart",
        }),
        draw: ({ width, height, layout }) =>
            buildChart(rows, maps, width, height, layout),
    });
}

// Pre-compute everything each bar will need so the render path
// never has to re-derive values from the raw map list. Walks
// every (previous, current) pair and emits one row when both
// sides expose an unfilled variant. Pairs missing either side
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

function buildChart(rows, domainMaps, width, height, layout) {
    const plot = plotBounds(width, height, layout);

    const values = rows.map((r) => r.delta);
    const yTicks = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
    const yScale = linearScale([yTicks[0], yTicks.at(-1)], [plot.bottom, plot.top]);

    // The x domain spans every build in the slice, not just the
    // pairs that produced a bar. This pixel-aligns the delta x axis
    // with the map size and drift charts above, so a build at the
    // same release date sits at the same horizontal position in
    // every history chart. Missing bars then visibly mark builds
    // that had no comparable previous build (filled-only neighbour
    // or the very first build), rather than silently shifting the
    // chart's start to a later date. The start snaps to the first
    // of its month so the leftmost calendar tick lands flush with
    // plot.left.
    const domainStart = snapToMonthStart(
        new Date(domainMaps[0].released_at).getTime(),
    );
    const domainEnd = new Date(domainMaps[domainMaps.length - 1].released_at).getTime();
    const xScale = linearScale([domainStart, domainEnd], [plot.left, plot.right]);

    const barTimestamps = rows.map((r) => new Date(r.released_at).getTime());
    const xAt = (i) => xScale(barTimestamps[i]);
    const barWidth = pickBarWidth(barTimestamps, xScale, plot);

    const root = svg("svg", {
        viewBox: `0 0 ${width} ${height}`,
        class: "chart",
        role: "presentation",
    });
    root.setAttribute(
        "aria-label",
        "Source-data entry count delta between consecutive ASmap builds. Hover each bar for details.",
    );

    renderYAxis(root, yTicks, yScale, {
        plotLeft: plot.left,
        plotRight: plot.right,
        format: formatTick,
    });
    renderYAxisTitle(root, "Entries", plot);

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

    const ticks = pickTimeAxisTicks(
        domainStart,
        domainEnd,
        labelDensityForWidth(width),
    );
    renderTimeAxis(root, ticks, xScale, plot.bottom);

    return shell;
}

// Uniform bar width sized from the smallest gap between adjacent
// build timestamps so dense clusters never overlap. Falls back to
// the full plot width when only one bar exists (a single delta is
// shown as a moderate centred bar rather than a chart-wide block).
function pickBarWidth(timestamps, xScale, plot) {
    if (timestamps.length < 2) return MAX_BAR_WIDTH;
    let minGap = Infinity;
    for (let i = 1; i < timestamps.length; i++) {
        const gap = xScale(timestamps[i]) - xScale(timestamps[i - 1]);
        if (gap < minGap) minGap = gap;
    }
    if (!Number.isFinite(minGap) || minGap <= 0) {
        return Math.min(MAX_BAR_WIDTH, plot.right - plot.left);
    }
    return Math.max(MIN_BAR_WIDTH, Math.min(MAX_BAR_WIDTH, minGap * BAR_FILL_FRACTION));
}

function formatSignedDelta(value) {
    return value > 0 ? `+${formatNumber(value)}` : formatNumber(value);
}

function formatTick(value) {
    const abs = Math.abs(value);
    return abs >= 1000 ? `${Math.round(value / 1000)}k` : String(value);
}
