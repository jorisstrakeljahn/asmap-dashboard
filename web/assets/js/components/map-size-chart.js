// Dual-line chart of file_size_bytes over time, one series for the
// embedded (filled) variant and one for the source (unfilled)
// variant. Hover anywhere over the chart to pin the nearest build
// and read both sizes plus the fill-compression ratio in the
// tooltip.
//
// The two series tell different stories:
//
//   - Filled is what every Bitcoin Core node embeds today. Anyone
//     asking "how heavy is the upgrade?" wants this number.
//   - Unfilled is the raw upstream prefix data the build was
//     produced from. Anyone asking "how much did the source data
//     grow?" wants this number.
//
// Drawing them on the same axis makes the fill-heuristic effect
// visible at a glance: filled stays roughly flat while unfilled
// climbs as RPKI / IRR coverage broadens.

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

const DOT_RADIUS = 3;
// Hover tolerance: how far past the plot bounds we still treat
// the cursor as "over the chart". Keeps the tooltip from
// flickering off when the mouse grazes the gutter.
const HOVER_BLEED = 12;

// Series definitions live at module scope so the line, dots, and
// legend all draw from the same source of truth. ``profile`` is
// the variant accessor; ``className`` drives the SVG palette via
// charts.css; ``label`` and ``description`` flow into the legend
// and the tooltip header.
const SERIES = [
    {
        key: "filled",
        label: "Embedded (filled)",
        description: "What Bitcoin Core nodes ship",
        className: "chart__line--filled",
        dotClassName: "chart__dot--filled",
        legendClassName: "chart-legend__swatch--filled",
        profile: filledProfile,
    },
    {
        key: "unfilled",
        label: "Source data (unfilled)",
        description: "Upstream prefix data",
        className: "chart__line--unfilled",
        dotClassName: "chart__dot--unfilled",
        legendClassName: "chart-legend__swatch--unfilled",
        profile: unfilledProfile,
    },
];

export function mount(parent, maps) {
    if (!parent) return;
    if (maps.length < 2) {
        parent.replaceChildren();
        return;
    }
    mountResponsiveChart(parent, {
        title: "Map Size Over Time",
        legend: () => buildLegend(),
        draw: ({ width, height, layout }) =>
            buildChart(maps, width, height, layout),
    });
}

function buildChart(maps, width, height, layout) {
    const plot = plotBounds(width, height, layout);

    // Per-series sample list: one entry per build with the file
    // size when present, or null when the variant is missing.
    // Keeping nulls inline preserves the index alignment with the
    // x axis so the tooltip's nearestIndex() result indexes both
    // series consistently.
    const samples = SERIES.map((s) => ({
        ...s,
        values: maps.map((m) => s.profile(m)?.file_size_bytes ?? null),
    }));

    const allSizes = samples.flatMap((s) => s.values).filter((v) => v != null);
    if (allSizes.length === 0) {
        return emptyState();
    }

    const yTicks = niceTicks(Math.min(...allSizes), Math.max(...allSizes));
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
        "ASmap file size over time, embedded vs source data variant; hover the chart for exact values per build",
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

    // Lines: one per series, broken into smooth sub-paths whenever
    // a build is missing the variant. This keeps the curve from
    // ramping toward a phantom zero across the gap.
    for (const s of samples) {
        for (const segment of contiguousSegments(s.values, xAt, yScale)) {
            root.append(
                svg("path", {
                    d: smoothPath(segment),
                    class: `chart__line ${s.className}`,
                }),
            );
        }
    }

    // Dots: one per (series, build) where the variant is present.
    for (const s of samples) {
        for (let i = 0; i < s.values.length; i++) {
            if (s.values[i] == null) continue;
            root.append(
                svg("circle", {
                    cx: xAt(i),
                    cy: yScale(s.values[i]),
                    r: DOT_RADIUS,
                    class: `chart__dot ${s.dotClassName}`,
                }),
            );
        }
    }

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

        const filled = filledProfile(m);
        const unfilled = unfilledProfile(m);
        const rows = [];
        if (filled) {
            rows.push(["Embedded (filled)", `${formatNumber(filled.file_size_bytes)} bytes`]);
        } else {
            rows.push(["Embedded (filled)", "not published"]);
        }
        if (unfilled) {
            rows.push(["Source (unfilled)", `${formatNumber(unfilled.file_size_bytes)} bytes`]);
        } else {
            rows.push(["Source (unfilled)", "not published"]);
        }
        if (filled && unfilled) {
            // Compression ratio is the share of bytes the fill
            // heuristic shaves off the upstream encoding. A value
            // near 0 % means the build had nothing to compress;
            // 60 % means filled is 40 % of unfilled. Reads more
            // naturally as "how much smaller did filling make it"
            // than the raw ratio would.
            const saved = 1 - filled.file_size_bytes / unfilled.file_size_bytes;
            rows.push(["Fill compression", formatPercent(saved, 1)]);
        }

        showTooltip(
            tip,
            buildTooltipBody({
                title: formatDate(m.released_at),
                rows,
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

// Split a values array (with nulls for missing samples) into
// contiguous segments of [x, y] pairs. Each segment is later fed
// to smoothPath() independently so the curve breaks at the gap
// instead of bridging it.
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

function buildLegend() {
    const legend = document.createElement("div");
    legend.className = "chart-legend";
    for (const s of SERIES) {
        const item = document.createElement("span");
        item.className = "chart-legend__item";
        const swatch = document.createElement("span");
        swatch.className = `chart-legend__swatch ${s.legendClassName}`;
        const text = document.createElement("span");
        text.append(document.createTextNode(`${s.label} `));
        const muted = document.createElement("span");
        muted.className = "muted";
        muted.textContent = `\u00b7 ${s.description}`;
        text.append(muted);
        item.append(swatch, text);
        legend.append(item);
    }
    return legend;
}

function emptyState() {
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = "No published variants for the loaded builds.";
    return note;
}
