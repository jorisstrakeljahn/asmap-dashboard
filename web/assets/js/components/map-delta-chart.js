// Bar chart of entry-count delta vs last diffable predecessor,
// computed from the unfilled variant on both sides. Bars at real
// release timestamps (not uniform slots) so a publishing pause
// shows as a wide gap. Uses the same last-diffable-predecessor
// bridge as the drift card and the step-drift chart, so all
// three stay in lockstep.

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
import { t } from "../utils/i18n.js";
import { unfilledProfile } from "../utils/map-variants.js";
import { createInfoTooltip } from "./info-tooltip.js";

// Uniform bar width (no "fatter bar = bigger delta" misreading)
// driven by the smallest neighbour gap so dense clusters never
// overlap.
const MIN_BAR_WIDTH = 3;
const MAX_BAR_WIDTH = 14;
const BAR_FILL_FRACTION = 0.7;
const BAR_CORNER_RADIUS = 2;

export function mount(parent, maps, options = {}) {
    if (!parent || !Array.isArray(maps) || maps.length === 0) return;
    const rows = deltasBetween(maps);
    // No diffable pair in the picked range: spell the empty state
    // out so the slot does not silently render blank. The drift
    // charts use the same affordance; matching them keeps the
    // history section's empty-state vocabulary consistent.
    if (rows.length < 1) {
        parent.replaceChildren(mutedNote(t("history.mapDeltaChart.empty")));
        return;
    }
    mountResponsiveChart(parent, {
        title: t("history.mapDeltaChart.title"),
        info: createInfoTooltip({
            body: t("history.mapDeltaChart.info"),
            ariaLabel: t("history.mapDeltaChart.infoAria"),
        }),
        draw: ({ width, height, layout }) =>
            buildChart(rows, maps, width, height, layout, options),
    });
}

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

    // X domain spans every build (not just bar-producing pairs)
    // so this chart's axis pixel-aligns with the other history
    // charts and missing bars visibly mark filled-only neighbours.
    const buildTimestamps = maps.map((m) => new Date(m.released_at).getTime());
    const { domainStart, domainEnd } = resolveTimeDomain(buildTimestamps, options);
    const xScale = linearScale([domainStart, domainEnd], [plot.left, plot.right]);

    const barTimestamps = rows.map((r) => new Date(r.released_at).getTime());
    const xAt = (i) => xScale(barTimestamps[i]);
    const barWidth = pickBarWidth(barTimestamps, xScale, plot);

    const root = createChartSvg(
        width,
        height,
        t("history.mapDeltaChart.ariaLabel"),
    );

    renderYAxis(root, yTicks, yScale, {
        plotLeft: plot.left,
        plotRight: plot.right,
        format: formatTick,
    });

    // Zero baseline before bars: covered where positive, visible
    // where negative.
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
    // Tracked so a fast mouseleave on the shell (not the bar)
    // still clears the highlight.
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
                        [
                            t("history.mapDeltaChart.deltaLabel"),
                            t("history.mapDeltaChart.deltaUnit", {
                                value: formatSignedDelta(row.delta),
                            }),
                        ],
                        [
                            t("history.mapDeltaChart.entriesPrevThis"),
                            t("history.mapDeltaChart.entriesTransition", {
                                prev: formatNumber(row.prev_entries),
                                curr: formatNumber(row.entries),
                            }),
                        ],
                    ],
                    footer: t("history.mapDeltaChart.vsDate", {
                        date: formatDate(row.previous_released_at),
                    }),
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
