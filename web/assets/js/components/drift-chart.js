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
// A fourth dashed Total drift line traces the sum of the three
// categories, so the headline "how big is the change" number
// stays one glance away even after the composition split.
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
// Legend entries are clickable. Toggling one off hides its line
// and rescales the y axis to whatever stays on, so the reader can
// zoom into a single category without leaving the chart.
//
// All ratios use total / max(entries_a, entries_b) so they share
// a denominator with the diff explorer's match-rate banner. The
// Total line equals the "drift vs previous" the overview card
// shows whenever Step mode is selected.

import { mountResponsiveChart } from "../charts/chart-base.js";
import { buildTooltipBody } from "../charts/chart-tooltip.js";
import { buildLineChart } from "../charts/line-chart.js";
import { formatDate, formatNumber, formatPercent } from "../format.js";
import { mutedNote } from "../utils/dom.js";
import { unfilledProfile } from "../utils/variants.js";
import { createChartLegend } from "./chart-legend.js";
import { computePoints } from "./drift-chart-points.js";
import { createInfoTooltip } from "./info-tooltip.js";
import { createModeSwitch } from "./mode-switch.js";

// Shared "the chart cannot draw" message. Bundled here so the
// three early returns in mount() and the in-chart fallbacks read
// the same line and a future copy tweak lives in one place.
const EMPTY_MESSAGE = "Need at least two builds and one diff to plot drift.";

// Single source of truth for every per-series rendering choice.
// SERIES is in render order: the three composition categories
// first, then Total. Drawing Total last keeps its dashed line
// visually on top without occluding the categories underneath.
const SERIES = [
    {
        key: "reassigned",
        label: "Reassigned",
        accessor: (point) => point.reassigned_ratio,
        lineClass: "chart__line--reassigned",
        dotClass: "chart__dot--reassigned",
        swatchClass: "chart-legend__swatch--reassigned",
    },
    {
        key: "newly_mapped",
        label: "Newly Mapped",
        accessor: (point) => point.newly_ratio,
        lineClass: "chart__line--newly-mapped",
        dotClass: "chart__dot--newly-mapped",
        swatchClass: "chart-legend__swatch--newly-mapped",
    },
    {
        key: "unmapped",
        label: "Unmapped",
        accessor: (point) => point.unmapped_ratio,
        lineClass: "chart__line--unmapped",
        dotClass: "chart__dot--unmapped",
        swatchClass: "chart-legend__swatch--unmapped",
    },
    {
        key: "total",
        label: "Total drift",
        accessor: (point) => point.total_ratio,
        lineClass: "chart__line--total",
        dotClass: "chart__dot--total",
        swatchClass: "chart-legend__swatch--total",
    },
];

// Reading order for the legend and the hover tooltip: aggregate
// first, then the categories that compose it. Decoupled from the
// SERIES render order so we can place Total visually on top while
// still surfacing it as the headline reading in the legend.
const READING_ORDER = ["total", "reassigned", "newly_mapped", "unmapped"];
const SERIES_BY_KEY = Object.fromEntries(SERIES.map((s) => [s.key, s]));
const SERIES_IN_READING_ORDER = READING_ORDER.map((k) => SERIES_BY_KEY[k]);

const DRIFT_INFO = [
    "Composition of drift between asmap-data builds, broken into the three change categories the diff pipeline emits plus a total line that traces their sum.",
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
    {
        lead: "Total drift.",
        text: "Sum of the three categories. In Step mode this matches the drift figure the overview card shows for the same pair.",
    },
    "Click any legend entry to hide that line and rescale the chart to whatever stays on. Computed from the unfilled (source data) variant of every build. Builds that did not publish an unfilled variant appear as gaps.",
];

// Public mount: render the drift card under ``parent``. The card
// owns its own state (mode) and re-draws the chart on every
// state change.
export function mount(parent, maps, diffs, options = {}) {
    if (!parent) return;
    if (!Array.isArray(maps) || maps.length < 2) {
        parent.replaceChildren(mutedNote(EMPTY_MESSAGE));
        return;
    }
    if (!Array.isArray(diffs) || diffs.length === 0) {
        parent.replaceChildren(mutedNote(EMPTY_MESSAGE));
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
        parent.replaceChildren(mutedNote(EMPTY_MESSAGE));
        return;
    }

    // Mode and toggle state survive across mounts when the caller
    // passes ``options.state``. Mutating callbacks below write to
    // the same object so a range-picker swap that re-mounts this
    // chart sees the previously-picked mode and hidden series
    // already populated. Fresh defaults when called standalone.
    const state = options.state ?? { mode: "cumulative", hidden: new Set() };
    if (!state.mode) state.mode = "cumulative";
    if (!state.hidden) state.hidden = new Set();

    const card = document.createElement("article");
    card.className = "card chart-card drift-chart";

    const header = buildHeader({
        modeValue: state.mode,
        onModeChange: (next) => {
            state.mode = next;
            ctrl?.rerender();
        },
    });
    const legend = createChartLegend({
        entries: SERIES_IN_READING_ORDER,
        hidden: state.hidden,
        onToggle: (key) => {
            if (state.hidden.has(key)) state.hidden.delete(key);
            else state.hidden.add(key);
            ctrl?.rerender();
        },
    });
    const chartSlot = document.createElement("div");
    chartSlot.className = "drift-chart__plot";

    card.append(header, legend, chartSlot);
    parent.replaceChildren(card);

    // mountResponsiveChart sets up the ResizeObserver once and
    // returns a rerender handle the toggle and mode callbacks
    // call to redraw the SVG without rebuilding the slot.
    const ctrl = mountResponsiveChart(chartSlot, {
        title: null,
        draw: ({ width, height, layout }) =>
            buildChart(
                sortedMaps,
                computePoints(sortedMaps, diffs, state.mode),
                state.mode,
                state.hidden,
                width,
                height,
                layout,
                options,
            ),
    });
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

// ---- Chart assembly ---------------------------------------------

// Drift-specific assembly: bridge between the (sortedMaps, points)
// pair and the unified line-chart scaffold. Decides what counts as
// an empty state, then hands a flat spec down for rendering.
function buildChart(sortedMaps, points, mode, hidden, width, height, layout, options) {
    const visibleSeries = SERIES.filter((s) => !hidden.has(s.key));
    if (visibleSeries.length === 0) {
        return mutedNote("All series hidden. Click a legend entry to bring one back.");
    }

    const valueAt = (key, slotIndex) => {
        const point = points[slotIndex];
        if (!point.present) return null;
        return SERIES_BY_KEY[key].accessor(point);
    };

    // Y axis tracks only the visible series so toggling a tall
    // line off zooms the remaining ones in. Hidden series stay in
    // hover tooltips because the data point still exists.
    const visibleRatios = points
        .filter((p) => p.present)
        .flatMap((p) => visibleSeries.map((s) => s.accessor(p)));
    if (visibleRatios.length === 0) {
        return mutedNote("No drift data for the picked mode.");
    }

    return buildLineChart(
        {
            timestamps: sortedMaps.map((m) => new Date(m.released_at).getTime()),
            visibleSeries,
            valueAt,
            // niceTicks on a flat-zero domain still needs a non-zero
            // upper bound. 1 % keeps the y axis usable even when
            // every plotted point happens to be zero.
            yMin: 0,
            yMax: Math.max(0.01, ...visibleRatios),
            yFormat: (tick) => formatPercent(tick, 0),
            yTitle: "Share",
            ariaLabel: ariaLabelFor(mode),
            tooltipBodyAt: (slotIndex) =>
                buildTooltipBody({
                    title: formatDate(sortedMaps[slotIndex].released_at),
                    rows: hoverRows(points[slotIndex]),
                    footer: footerFor(points[slotIndex], mode),
                }),
        },
        width,
        height,
        layout,
        options,
    );
}

function ariaLabelFor(mode) {
    if (mode === "cumulative") {
        return "Cumulative drift composition since the oldest published build. Reassigned, newly mapped, unmapped, and total drift series.";
    }
    return "Step drift composition between consecutive builds. Reassigned, newly mapped, unmapped, and total drift series.";
}

// Tooltip rows in reading order, so Total drift sits at the top
// just like in the legend. Every series is included regardless
// of whether the user hid the matching line, because the data
// point still exists and the tooltip is the inspection surface.
// The Total row carries the absolute change count too, since the
// percentage alone hides the magnitude.
function hoverRows(point) {
    if (!point.present) {
        return [["Drift", "no diff for this build"]];
    }
    return SERIES_IN_READING_ORDER.map((series) => {
        const pct = formatPercent(series.accessor(point), 1);
        if (series.key === "total") {
            return [series.label, `${pct} (${formatNumber(point.total_changes)})`];
        }
        return [series.label, pct];
    });
}

function footerFor(point, mode) {
    if (!point.present || !point.vs) return point.map.name;
    const vsLabel = formatDate(point.vs.released_at);
    return mode === "cumulative" ? `since ${vsLabel}` : `vs ${vsLabel}`;
}
