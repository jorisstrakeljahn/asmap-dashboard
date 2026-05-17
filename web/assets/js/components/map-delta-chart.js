// Vertical bar chart of entry-count delta against the last
// diffable predecessor, computed from the unfilled (source data)
// variant of both sides. Each bar is the gain or loss in real
// source-data prefixes between this build and the most recent
// earlier build that actually published an unfilled variant.
// Positive deltas grow up from the baseline, negative down. Hover
// a bar for the exact prev-to-this entry counts, the signed
// delta, and the date of the predecessor it diffed against.
//
// Builds without an unfilled variant contribute no bar because
// the entry count is missing on their side. Builds whose direct
// predecessor is filled-only still contribute, because the
// bridge falls back to the last build that did publish an
// unfilled variant. That keeps the chart in lockstep with the
// drift card and the step-drift chart, both of which use the
// same last-diffable-predecessor rule.

import { linearScale, niceTicks, svg } from "../charts/svg.js";
import {
    createChartSvg,
    labelDensityForWidth,
    mountResponsiveChart,
    pickTimeAxisTicks,
    plotBounds,
    renderTimeAxis,
    renderYAxis,
    resolveTimeDomain,
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
import { mutedNote } from "../utils/dom.js";
import { previousDiffable } from "../utils/diffs.js";
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
    "Gain or loss in source-data prefix entries between each build and the most recent earlier build that published an unfilled variant.",
    "A positive bar means this build added that many real (prefix to ASN) entries on top of its diffable predecessor. A negative bar means entries fell out of the upstream data, typically because RPKI / IRR coverage retracted for some prefix.",
    "Computed from the unfilled (source data) variant of both sides. Builds whose immediate predecessor is filled-only fall back to the last build that did publish an unfilled variant, so a single filled-only release no longer blanks out the surrounding bars. Builds without an unfilled variant themselves still render as an empty column.",
    "Hover any bar for the exact entry counts and the date of the predecessor the diff was taken against.",
];

export function mount(parent, maps, options = {}) {
    if (!parent || !Array.isArray(maps) || maps.length === 0) return;
    const rows = deltasBetween(maps);
    // No diffable pair in the picked range: spell the empty state
    // out so the slot does not silently render blank. The drift
    // charts use the same affordance; matching them keeps the
    // history section's empty-state vocabulary consistent.
    if (rows.length < 1) {
        parent.replaceChildren(
            mutedNote(
                "Need at least two builds with an unfilled variant to plot deltas.",
            ),
        );
        return;
    }
    mountResponsiveChart(parent, {
        title: "Source Data Entries Delta Between Builds",
        info: createInfoTooltip({
            body: MAP_DELTA_INFO,
            ariaLabel: "About the entries delta chart",
        }),
        draw: ({ width, height, layout }) =>
            buildChart(rows, maps, width, height, layout, options),
    });
}

// Pre-compute everything each bar will need so the render path
// never has to re-derive values from the raw map list. For every
// build that exposes an unfilled variant, walk back via
// ``previousDiffable`` to find the most recent earlier build that
// also published one, then emit a row. Builds with no diffable
// predecessor (the oldest build, or anything older than the first
// published unfilled variant) produce no row. Builds without
// their own unfilled variant likewise produce no row, since the
// "this" side of the diff would be missing.
function deltasBetween(maps) {
    const rows = [];
    for (let i = 0; i < maps.length; i++) {
        const current = unfilledProfile(maps[i]);
        if (!current) continue;
        const previousMap = previousDiffable(maps, maps[i].name);
        if (!previousMap) continue;
        const previous = unfilledProfile(previousMap);
        if (!previous) continue;
        rows.push({
            released_at: maps[i].released_at,
            previous_released_at: previousMap.released_at,
            entries: current.entries_count,
            prev_entries: previous.entries_count,
            delta: current.entries_count - previous.entries_count,
        });
    }
    return rows;
}

function buildChart(rows, maps, width, height, layout, options) {
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
    // chart's start to a later date.
    const buildTimestamps = maps.map((m) => new Date(m.released_at).getTime());
    const { domainStart, domainEnd } = resolveTimeDomain(buildTimestamps, options);
    const xScale = linearScale([domainStart, domainEnd], [plot.left, plot.right]);

    const barTimestamps = rows.map((r) => new Date(r.released_at).getTime());
    const xAt = (i) => xScale(barTimestamps[i]);
    const barWidth = pickBarWidth(barTimestamps, xScale, plot);

    const root = createChartSvg(
        width,
        height,
        "Source-data entry count delta between each ASmap build and its last diffable predecessor. Hover each bar for details.",
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
    // Track the currently-highlighted bar so a fast cursor exit
    // (mouseleave on the shell, not on the bar itself) still
    // clears the active class. Without this guard the soft-accent
    // fill can stick when the user whips the cursor off the chart.
    let activeBar = null;
    const clearActive = () => {
        if (activeBar) {
            activeBar.classList.remove("chart__bar--active");
            activeBar = null;
        }
    };
    const hide = () => {
        hideTooltip(tip);
        clearActive();
    };

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
            clearActive();
            bar.classList.add("chart__bar--active");
            activeBar = bar;
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
                    // Naming the predecessor matters when the
                    // direct previous build was filled-only and we
                    // bridged across it. Always rendering the
                    // footer (not just for filled-only skips) keeps
                    // the reader from having to remember the rule.
                    footer: `vs ${formatDate(row.previous_released_at)}`,
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
