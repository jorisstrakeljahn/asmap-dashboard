// Dual-line chart of file_size_bytes over time, one series for the
// embedded (filled) variant and one for the source (unfilled)
// variant. Hover anywhere over the chart to pin the nearest build
// and read both sizes plus the fill-compression ratio in the
// tooltip.
//
// The two series tell different stories. Filled is what every
// Bitcoin Core node embeds today, so anyone asking "how heavy is
// the upgrade?" wants this number. Unfilled is the raw upstream
// prefix data the build was produced from, so anyone asking "how
// much did the source data grow?" wants this one. Drawing them on
// the same axis makes the fill-heuristic effect visible at a
// glance.

import {
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
import { formatDate, formatNumber, formatPercent, shortDate } from "../format.js";
import { filledProfile, unfilledProfile } from "../utils/variants.js";
import { createChartLegend } from "./chart-legend.js";
import { createInfoTooltip } from "./info-tooltip.js";

const DOT_RADIUS = 3;
// Hover tolerance: how far past the plot bounds we still treat
// the cursor as "over the chart". Keeps the tooltip from
// flickering off when the mouse grazes the gutter.
const HOVER_BLEED = 12;

// Series definitions are the single source of truth for every
// per-variant rendering decision. The legend, the SVG line and
// dot classes, and the hover tooltip rows all read from this
// list, so adding a third series later is a one-entry change.
//
// Source data leads because it is the upstream truth a build
// rests on. Embedded follows as the compressed shape Bitcoin
// Core actually ships. The two lines never overlap (filled is
// always smaller than unfilled), so the render order this list
// dictates has no visual effect and the same ordering is free
// to drive both the legend and the tooltip rows.
const SERIES = [
    {
        key: "unfilled",
        label: "Source data (unfilled)",
        lineClass: "chart__line--unfilled",
        dotClass: "chart__dot--unfilled",
        swatchClass: "chart-legend__swatch--unfilled",
        profile: unfilledProfile,
    },
    {
        key: "filled",
        label: "Embedded (filled)",
        lineClass: "chart__line--filled",
        dotClass: "chart__dot--filled",
        swatchClass: "chart-legend__swatch--filled",
        profile: filledProfile,
    },
];

const MAP_SIZE_INFO = [
    "On-disk size of every published ASmap build, plotted as two series so the fill-heuristic effect is visible at a glance.",
    {
        lead: "Source data (unfilled).",
        text: "Bytes of the raw upstream prefix data the build was produced from. Heavier than the embedded form because nothing has been compressed.",
    },
    {
        lead: "Embedded (filled).",
        text: "Bytes of the binary Bitcoin Core actually ships. Adjacent same-AS prefixes are collapsed so the file stays small.",
    },
    "Hover any build for the two raw sizes plus the fill-compression ratio between them. Builds that did not publish a variant show a gap rather than bridging the line toward zero.",
];

export function mount(parent, maps) {
    if (!parent) return;
    if (maps.length < 2) {
        parent.replaceChildren();
        return;
    }
    // Local toggle state lives in this closure. The legend
    // callback below mutates it and asks the chart for a redraw
    // through the rerender handle mountResponsiveChart returns.
    // The handle is captured lazily (read at click time) so the
    // legend factory can reference it before assignment.
    const state = { hidden: new Set() };
    let ctrl;
    ctrl = mountResponsiveChart(parent, {
        title: "Map Size Over Time",
        info: createInfoTooltip({
            body: MAP_SIZE_INFO,
            ariaLabel: "About the map size chart",
        }),
        legend: () =>
            createChartLegend({
                entries: SERIES,
                hidden: state.hidden,
                onToggle: (key) => {
                    if (state.hidden.has(key)) state.hidden.delete(key);
                    else state.hidden.add(key);
                    ctrl?.rerender();
                },
            }),
        draw: ({ width, height, layout }) =>
            buildChart(maps, state.hidden, width, height, layout),
    });
}

// Top-level chart assembly. Returns the chart shell, or an empty
// state node when no published variant could yield a single
// data point or every series has been toggled off in the legend.
// Each sub-pass (axes, series, hover) lives in its own helper so
// this function reads as the storyboard.
function buildChart(maps, hidden, width, height, layout) {
    const samples = sampleSeries(maps);
    const visible = samples.filter((s) => !hidden.has(s.key));
    if (visible.length === 0) {
        return emptyState("All series hidden. Click a legend entry to bring one back.");
    }
    // Y axis tracks only the visible series so toggling the
    // unfilled line off zooms the filled line in (and the other
    // way round). Hidden series stay in the hover tooltip
    // because the data point still exists.
    const visibleSizes = visible
        .flatMap((s) => s.values)
        .filter((v) => v != null);
    if (visibleSizes.length === 0) {
        return emptyState();
    }

    const geometry = computeGeometry(maps, visibleSizes, width, height, layout);
    const root = createSvgRoot(width, height);

    drawAxes(root, maps, geometry, width);
    drawSeriesLines(root, visible, geometry);
    drawSeriesDots(root, visible, geometry);

    return attachHover(root, maps, geometry);
}

// ---- Sample preparation ----------------------------------------

// One row per build, one column per series. Nulls inline preserve
// index alignment with the x axis so the hover handler's
// nearestIndex() result indexes both series consistently.
function sampleSeries(maps) {
    return SERIES.map((series) => ({
        ...series,
        values: maps.map(
            (m) => series.profile(m)?.file_size_bytes ?? null,
        ),
    }));
}

// Single computation of plot bounds, axis ticks, and the two
// scales every sub-pass needs. Centralised here so the y ticks
// the axis renders are guaranteed to match the y scale the lines
// and dots are positioned with. ``sizes`` carries only the
// values of the visible series so toggles rescale the y axis.
function computeGeometry(maps, sizes, width, height, layout) {
    const plot = plotBounds(width, height, layout);
    const yTicks = niceTicks(Math.min(...sizes), Math.max(...sizes));
    const yScale = linearScale(
        [yTicks[0], yTicks.at(-1)],
        [plot.bottom, plot.top],
    );
    const xScale = linearScale(
        [0, maps.length - 1],
        [plot.left, plot.right],
    );
    return { plot, yTicks, yScale, xAt: (i) => xScale(i) };
}

// ---- Static drawing --------------------------------------------

function createSvgRoot(width, height) {
    const root = svg("svg", {
        viewBox: `0 0 ${width} ${height}`,
        class: "chart",
        role: "presentation",
    });
    root.setAttribute(
        "aria-label",
        "ASmap file size over time, embedded vs source data variant. Hover the chart for exact values per build.",
    );
    return root;
}

function drawAxes(root, maps, { plot, yTicks, yScale, xAt }, width) {
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
}

// One smooth path per series, broken into sub-segments wherever a
// build is missing the variant. This keeps the curve from ramping
// toward a phantom zero across the gap.
function drawSeriesLines(root, samples, { xAt, yScale }) {
    for (const series of samples) {
        for (const segment of contiguousSegments(series.values, xAt, yScale)) {
            root.append(
                svg("path", {
                    d: smoothPath(segment),
                    class: `chart__line ${series.lineClass}`,
                }),
            );
        }
    }
}

function drawSeriesDots(root, samples, { xAt, yScale }) {
    for (const series of samples) {
        for (let i = 0; i < series.values.length; i++) {
            const value = series.values[i];
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

// Split a values array (with nulls for missing samples) into
// contiguous segments of [x, y] pairs. Each segment is fed to
// smoothPath() on its own so the curve breaks at the gap instead
// of bridging it.
function contiguousSegments(values, xAt, yScale) {
    const segments = [];
    let current = [];
    for (let i = 0; i < values.length; i++) {
        if (values[i] == null) {
            if (current.length >= 2) segments.push(current);
            current = [];
            continue;
        }
        current.push([xAt(i), yScale(values[i])]);
    }
    if (current.length >= 2) segments.push(current);
    return segments;
}

// ---- Hover -----------------------------------------------------

function attachHover(root, maps, { plot, xAt }) {
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
        const map = maps[idx];
        const x = xAt(idx);
        cursorLine.setAttribute("x1", String(x));
        cursorLine.setAttribute("x2", String(x));
        cursorLine.setAttribute("visibility", "visible");
        showTooltip(
            tip,
            buildTooltipBody({
                title: formatDate(map.released_at),
                rows: hoverRows(map),
                footer: map.name,
            }),
        );
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
        show(nearestIndex(pt.x, maps.length, xAt), ev);
    });
    shell.addEventListener("mouseleave", hide);

    return shell;
}

// Tooltip rows: one per series with its size or "not published",
// plus an extra fill-compression row when both sides exist. Rows
// reuse the same SERIES.label text the legend uses, so renaming
// a variant only touches the SERIES entry.
function hoverRows(map) {
    const rows = SERIES.map((series) => {
        const profile = series.profile(map);
        const value = profile
            ? `${formatNumber(profile.file_size_bytes)} bytes`
            : "not published";
        return [series.label, value];
    });

    const filled = filledProfile(map);
    const unfilled = unfilledProfile(map);
    if (filled && unfilled) {
        // Compression is the share of bytes the fill heuristic
        // shaves off the upstream encoding. Reads more naturally
        // as "how much smaller did filling make it" than the raw
        // size ratio would.
        const saved = 1 - filled.file_size_bytes / unfilled.file_size_bytes;
        rows.push(["Fill compression", formatPercent(saved, 1)]);
    }
    return rows;
}

// ---- Static UI -------------------------------------------------

function emptyState(text = "No published variants for the loaded builds.") {
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = text;
    return note;
}
