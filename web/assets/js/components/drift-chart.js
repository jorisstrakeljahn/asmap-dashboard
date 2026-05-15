// Drift composition chart: how an asmap-data build differs from a
// reference, broken into the three change categories the diff
// pipeline emits. The single "drift %" line that used to live here
// answered "how big was this update?" but said nothing about the
// character of the change. Splitting into Reassigned, Newly
// Mapped, and Unmapped lines lets the reader see whether a jump
// came from prefix routing churn (Reassigned), from coverage
// growth (Newly Mapped), or from upstream data dropping prefixes
// (Unmapped).
//
// Two modes share the same plot:
//
//   - Cumulative (default). For each build, the diff against the
//     oldest published build. Lines grow over time and answer
//     "how outdated is an embedded asmap?".
//   - Step. For each build, the diff against the immediately
//     previous build. Highlights the character of individual
//     asmap-data updates and answers "what kind of change was
//     this release?".
//
// All ratios use total / max(entries_a, entries_b) so they share
// a denominator with the diff explorer's match-rate banner. Sum
// of the three series at any point equals the "total drift" the
// overview card shows for the same pair.

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
import { linearScale, niceTicks, smoothPath, svg } from "../charts/svg.js";
import { formatDate, formatNumber, formatPercent, shortDate } from "../format.js";
import { unfilledProfile } from "../utils/variants.js";
import { createInfoTooltip } from "./info-tooltip.js";
import { createModeSwitch } from "./mode-switch.js";

const DOT_RADIUS = 3;
// Hover tolerance: how far past the plot bounds we still treat
// the cursor as "over the chart". Keeps the tooltip from
// flickering off when the mouse grazes the gutter.
const HOVER_BLEED = 12;

// Single source of truth for every per-category rendering choice.
// The legend, the SVG line and dot classes, and the hover tooltip
// rows all read from this list. Adding a fourth category later is
// a one-entry change.
const SERIES = [
    {
        key: "reassigned",
        label: "Reassigned",
        accessor: (point) => point.reassigned_ratio,
        countAccessor: (point) => point.reassigned,
        lineClass: "chart__line--reassigned",
        dotClass: "chart__dot--reassigned",
        swatchClass: "chart-legend__swatch--reassigned",
    },
    {
        key: "newly_mapped",
        label: "Newly Mapped",
        accessor: (point) => point.newly_ratio,
        countAccessor: (point) => point.newly_mapped,
        lineClass: "chart__line--newly-mapped",
        dotClass: "chart__dot--newly-mapped",
        swatchClass: "chart-legend__swatch--newly-mapped",
    },
    {
        key: "unmapped",
        label: "Unmapped",
        accessor: (point) => point.unmapped_ratio,
        countAccessor: (point) => point.unmapped,
        lineClass: "chart__line--unmapped",
        dotClass: "chart__dot--unmapped",
        swatchClass: "chart-legend__swatch--unmapped",
    },
];

const DRIFT_INFO = [
    "Composition of drift between asmap-data builds, broken into the three change categories the diff pipeline emits.",
    {
        lead: "Cumulative.",
        text: "How far each build has wandered from the oldest published build with an unfilled variant. Lines grow over time and tell you how outdated an embedded asmap becomes.",
    },
    {
        lead: "Step.",
        text: "How much each build changed compared to the previous build with an unfilled variant. Highlights individual asmap-data updates and their character.",
    },
    {
        lead: "Reassigned.",
        text: "Prefix kept its mapping but now points at a different autonomous system.",
    },
    {
        lead: "Newly Mapped.",
        text: "Prefix had no autonomous system in the reference and now resolves to one.",
    },
    {
        lead: "Unmapped.",
        text: "Prefix that resolved in the reference no longer resolves.",
    },
    "Computed from the unfilled (source data) variant of every build. Builds that did not publish an unfilled variant appear as gaps. The three lines sum to the total drift the overview card shows for the same pair.",
];

// Public mount: render the drift card under ``parent``. The card
// owns its own state (mode) and re-draws the chart on every
// state change.
export function mount(parent, maps, diffs) {
    if (!parent) return;
    if (!Array.isArray(maps) || maps.length < 2) {
        parent.replaceChildren(emptyState());
        return;
    }
    if (!Array.isArray(diffs) || diffs.length === 0) {
        parent.replaceChildren(emptyState());
        return;
    }

    const sortedMaps = [...maps].sort((a, b) =>
        a.released_at.localeCompare(b.released_at),
    );
    // Cumulative needs at least one build with an unfilled variant
    // to act as the anchor. Without it, neither mode has any data
    // to plot and we surface the empty state instead of an empty
    // chart card.
    if (!sortedMaps.some((m) => unfilledProfile(m) !== null)) {
        parent.replaceChildren(emptyState());
        return;
    }

    const state = { mode: "cumulative" };

    const card = document.createElement("article");
    card.className = "card chart-card drift-chart";

    const header = buildHeader({
        modeValue: state.mode,
        onModeChange: (next) => {
            state.mode = next;
            rerender();
        },
    });
    const legend = buildLegend();
    const chartSlot = document.createElement("div");
    chartSlot.className = "drift-chart__plot";

    card.append(header, legend, chartSlot);
    parent.replaceChildren(card);

    const rerender = () => {
        const points = computePoints(sortedMaps, diffs, state.mode);
        mountResponsiveChart(chartSlot, {
            title: null,
            draw: ({ width, height, layout }) =>
                buildChart(sortedMaps, points, state.mode, width, height, layout),
        });
    };
    rerender();
}

// ---- Card header (label, controls) ------------------------------

function buildHeader({ modeValue, onModeChange }) {
    const header = document.createElement("div");
    header.className = "drift-chart__header";

    const label = document.createElement("span");
    label.className = "card__label uppercase-label";
    label.textContent = "DRIFT OVER TIME";
    header.append(label);

    const modeSwitch = createModeSwitch({
        options: [
            { value: "cumulative", label: "Cumulative" },
            { value: "step", label: "Step" },
        ],
        value: modeValue,
        onChange: onModeChange,
        ariaLabel: "Drift comparison mode",
    });

    const info = createInfoTooltip({
        body: DRIFT_INFO,
        ariaLabel: "About the drift chart",
    });
    info.classList.add("drift-chart__info");

    const controls = document.createElement("div");
    controls.className = "drift-chart__controls";
    controls.append(modeSwitch, info);
    header.append(controls);

    return header;
}

// ---- Pure data layer --------------------------------------------

// Build one Point per chronological build slot. Each Point either
// carries the three category ratios for that slot or is marked as
// a gap. Gaps are rendered as breaks in the line so the chart
// never ramps toward a phantom zero across a missing diff.
//
// Returned array is index-aligned with sortedMaps so the hover
// handler's nearestIndex() result indexes both consistently.
export function computePoints(sortedMaps, diffs, mode) {
    if (mode === "cumulative") return cumulativePoints(sortedMaps, diffs);
    if (mode === "step") return stepPoints(sortedMaps, diffs);
    return sortedMaps.map((map, index) => gapPoint(map, index));
}

function cumulativePoints(sortedMaps, diffs) {
    // Anchor on the oldest build that actually published an unfilled
    // variant. The single filled-only build (2025-03-21) cannot
    // contribute a diff and would shift the anchor forward in time
    // for everything after it, which would silently relabel the
    // baseline. Filtering keeps the anchor stable and honest.
    const baseline = sortedMaps.find((m) => unfilledProfile(m) !== null);
    if (!baseline) return sortedMaps.map((m, i) => gapPoint(m, i));

    return sortedMaps.map((map, index) => {
        if (map.name === baseline.name) {
            return zeroPoint(map, index, baseline);
        }
        const diff = directionalDiff(diffs, baseline.name, map.name);
        return diff ? toPoint(map, index, diff, baseline) : gapPoint(map, index);
    });
}

function stepPoints(sortedMaps, diffs) {
    // "Previous" means "previous build that can actually be diffed
    // against", which excludes filled-only builds. If we picked the
    // raw chronological neighbour, the build immediately after a
    // filled-only one would always show as a gap because its
    // neighbour has no unfilled variant. Skipping over filled-only
    // neighbours produces the step the user expects, with the
    // tooltip footer naming the actual reference build.
    return sortedMaps.map((map, index) => {
        if (!unfilledProfile(map)) return gapPoint(map, index);
        const previous = lastDiffableBefore(sortedMaps, index);
        if (!previous) return zeroPoint(map, index, null);
        const diff = directionalDiff(diffs, previous.name, map.name);
        return diff ? toPoint(map, index, diff, previous) : gapPoint(map, index);
    });
}

function lastDiffableBefore(sortedMaps, index) {
    for (let i = index - 1; i >= 0; i--) {
        if (unfilledProfile(sortedMaps[i])) return sortedMaps[i];
    }
    return null;
}

// Strict directional lookup. Pipeline emits each pair exactly once
// with from < to chronologically, so callers passing chronological
// (older, newer) arguments always hit the canonical direction. We
// never want the symmetric fallback findDiff() in utils/diffs.js
// offers, because the asymmetric category fields (reassigned,
// newly_mapped, unmapped) only make sense in the canonical
// direction.
function directionalDiff(diffs, fromName, toName) {
    return (
        diffs.find((d) => d.from === fromName && d.to === toName) || null
    );
}

function toPoint(map, index, diff, vs) {
    const denom = Math.max(diff.entries_a, diff.entries_b);
    const ratio = (n) => (denom ? n / denom : 0);
    return {
        present: true,
        map,
        index,
        vs,
        denominator: denom,
        reassigned: diff.reassigned,
        newly_mapped: diff.newly_mapped,
        unmapped: diff.unmapped,
        total_changes: diff.total_changes,
        reassigned_ratio: ratio(diff.reassigned),
        newly_ratio: ratio(diff.newly_mapped),
        unmapped_ratio: ratio(diff.unmapped),
        total_ratio: ratio(diff.total_changes),
    };
}

function zeroPoint(map, index, vs) {
    return {
        present: true,
        map,
        index,
        vs,
        denominator: 0,
        reassigned: 0,
        newly_mapped: 0,
        unmapped: 0,
        total_changes: 0,
        reassigned_ratio: 0,
        newly_ratio: 0,
        unmapped_ratio: 0,
        total_ratio: 0,
    };
}

function gapPoint(map, index) {
    return { present: false, map, index };
}

// ---- Chart assembly ---------------------------------------------

// Top-level chart pass. Returns the chart shell, or an empty state
// node when the picked mode produced no plottable point. Each
// sub-pass (axes, series, hover) lives in its own helper so this
// function reads as the storyboard.
function buildChart(sortedMaps, points, mode, width, height, layout) {
    const allRatios = points
        .filter((p) => p.present)
        .flatMap((p) => SERIES.map((s) => s.accessor(p)));
    if (allRatios.length === 0) {
        return emptyState("No drift data for the picked mode.");
    }

    const geometry = computeGeometry(sortedMaps, allRatios, width, height, layout);
    const root = createSvgRoot(width, height, mode);

    drawAxes(root, sortedMaps, geometry, width);
    drawSeriesLines(root, points, geometry);
    drawSeriesDots(root, points, geometry);

    return attachHover(root, sortedMaps, points, geometry, mode);
}

function computeGeometry(sortedMaps, allRatios, width, height, layout) {
    const plot = plotBounds(width, height, layout);
    // niceTicks on a flat-zero domain still needs a non-zero upper
    // bound. 1 % keeps the y axis usable even when every plotted
    // point happens to be zero.
    const yTicks = niceTicks(0, Math.max(0.01, ...allRatios));
    const yScale = linearScale(
        [yTicks[0], yTicks.at(-1)],
        [plot.bottom, plot.top],
    );
    const xScale = linearScale(
        [0, sortedMaps.length - 1],
        [plot.left, plot.right],
    );
    return { plot, yTicks, yScale, xAt: (i) => xScale(i) };
}

function createSvgRoot(width, height, mode) {
    const root = svg("svg", {
        viewBox: `0 0 ${width} ${height}`,
        class: "chart",
        role: "presentation",
    });
    root.setAttribute("aria-label", ariaLabelFor(mode));
    return root;
}

function ariaLabelFor(mode) {
    if (mode === "cumulative") {
        return "Cumulative drift composition since the oldest published build. Three series for reassigned, newly mapped, and unmapped entries.";
    }
    return "Step drift composition between consecutive builds. Three series for reassigned, newly mapped, and unmapped entries.";
}

function drawAxes(root, sortedMaps, { plot, yTicks, yScale, xAt }, width) {
    renderYAxis(root, yTicks, yScale, {
        plotLeft: plot.left,
        plotRight: plot.right,
        format: (tick) => formatPercent(tick, 0),
    });
    renderXAxis(
        root,
        pickAxisLabelIndices(sortedMaps.length, labelDensityForWidth(width)),
        xAt,
        plot.bottom,
        (i) => shortDate(sortedMaps[i].released_at),
    );
}

// One smooth path per series, broken into sub-segments wherever a
// build sits in a gap. This keeps the curve from ramping toward a
// phantom zero across the missing diff.
function drawSeriesLines(root, points, { xAt, yScale }) {
    for (const series of SERIES) {
        for (const segment of contiguousSegments(points, series, xAt, yScale)) {
            root.append(
                svg("path", {
                    d: smoothPath(segment),
                    class: `chart__line ${series.lineClass}`,
                }),
            );
        }
    }
}

function drawSeriesDots(root, points, { xAt, yScale }) {
    for (const series of SERIES) {
        for (const point of points) {
            if (!point.present) continue;
            root.append(
                svg("circle", {
                    cx: xAt(point.index),
                    cy: yScale(series.accessor(point)),
                    r: DOT_RADIUS,
                    class: `chart__dot ${series.dotClass}`,
                }),
            );
        }
    }
}

// Split the index-aligned points list into contiguous [x, y]
// segments per series, breaking at gap points. Each segment is fed
// to smoothPath() on its own so the curve breaks at the gap
// instead of bridging it.
function contiguousSegments(points, series, xAt, yScale) {
    const segments = [];
    let current = [];
    for (const point of points) {
        if (!point.present) {
            if (current.length >= 2) segments.push(current);
            current = [];
            continue;
        }
        current.push([xAt(point.index), yScale(series.accessor(point))]);
    }
    if (current.length >= 2) segments.push(current);
    return segments;
}

// ---- Hover -------------------------------------------------------

function attachHover(root, sortedMaps, points, { plot, xAt }, mode) {
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
        const point = points[idx];
        cursorLine.setAttribute("x1", String(xAt(idx)));
        cursorLine.setAttribute("x2", String(xAt(idx)));
        cursorLine.setAttribute("visibility", "visible");
        showTooltip(
            tip,
            buildTooltipBody({
                title: formatDate(sortedMaps[idx].released_at),
                rows: hoverRows(point),
                footer: footerFor(point, mode),
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
        show(nearestIndex(pt.x, sortedMaps.length, xAt), ev);
    });
    shell.addEventListener("mouseleave", hide);

    return shell;
}

// Tooltip rows: a Total summary on top, then one row per series.
// Gap points get a single row stating no diff is available, so
// the user understands why the lines break.
function hoverRows(point) {
    if (!point.present) {
        return [["Drift", "no diff for this build"]];
    }
    const rows = [
        [
            "Total drift",
            `${formatPercent(point.total_ratio, 1)} (${formatNumber(point.total_changes)})`,
        ],
    ];
    for (const series of SERIES) {
        rows.push([series.label, formatPercent(series.accessor(point), 1)]);
    }
    return rows;
}

function footerFor(point, mode) {
    if (!point.present || !point.vs) return point.map.name;
    const vsLabel = formatDate(point.vs.released_at);
    return mode === "cumulative" ? `since ${vsLabel}` : `vs ${vsLabel}`;
}

// ---- Static UI ---------------------------------------------------

function buildLegend() {
    const legend = document.createElement("div");
    legend.className = "chart-legend";
    for (const series of SERIES) {
        const item = document.createElement("span");
        item.className = "chart-legend__item";
        const swatch = document.createElement("span");
        swatch.className = `chart-legend__swatch ${series.swatchClass}`;
        const label = document.createElement("span");
        label.textContent = series.label;
        item.append(swatch, label);
        legend.append(item);
    }
    return legend;
}

function emptyState(text = "Need at least two builds and one diff to plot drift.") {
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = text;
    return note;
}
