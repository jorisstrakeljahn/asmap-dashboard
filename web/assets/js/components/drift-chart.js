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
// Two modes share the same component, but they no longer share
// the same plot. Each mode renders into its own card so the two
// stories sit side-by-side and the reader does not have to
// switch a toggle to compare them:
//
//   - "cumulative". Diffs each build against the oldest published
//     build with an unfilled variant. Renders as four lines (the
//     three categories plus a dashed Total drift overlay) so the
//     reader can see how far each build has drifted from the
//     baseline at a glance and still see which kind of change
//     drives that drift.
//   - "step". Diffs each build against the immediately previous
//     diffable build. Renders as a stacked bar per release: the
//     three categories stack from the baseline up, and the total
//     stack height equals "drift vs previous" on the overview
//     card. Discrete bars match the visual idiom of the entries
//     delta chart below it; the line shape of an earlier draft
//     misleadingly implied continuity between independently
//     published builds.
//
// Callers pass the desired mode at mount time. Legend entries
// remain clickable per chart, so the reader can zoom one mode
// into a single category while leaving the other mode intact.
//
// All ratios use total / max(entries_a, entries_b) so they share
// a denominator with the diff explorer's match-rate banner. The
// Total line in step mode equals the "drift vs previous" the
// overview card shows for the same pair.

import { mountResponsiveChart } from "../charts/chart-base.js";
import { buildTooltipBody } from "../charts/chart-tooltip.js";
import { buildLineChart } from "../charts/line-chart.js";
import { buildStackedBarChart } from "../charts/stacked-bar-chart.js";
import { formatDate, formatNumber, formatPercent } from "../format.js";
import { mutedNote } from "../utils/dom.js";
import { unfilledProfile } from "../utils/variants.js";
import { createChartLegend } from "./chart-legend.js";
import { computePoints } from "./drift-chart-points.js";
import { createInfoTooltip } from "./info-tooltip.js";

// Shared "the chart cannot draw" message. Bundled here so the
// three early returns in mount() and the in-chart fallbacks read
// the same line and a future copy tweak lives in one place.
const EMPTY_MESSAGE = "Need at least two builds and one diff to plot drift.";

// Single source of truth for every per-series rendering choice.
// SERIES is in render order: the three composition categories
// first, then Total. Drawing Total last keeps its dashed line
// visually on top without occluding the categories underneath.
// The three category entries also carry a ``barClass`` so the
// step mode can render the same data as a stacked bar without
// duplicating the series catalogue.
const SERIES = [
    {
        key: "reassigned",
        label: "Reassigned",
        accessor: (point) => point.reassigned_ratio,
        lineClass: "chart__line--reassigned",
        dotClass: "chart__dot--reassigned",
        barClass: "chart__bar--reassigned",
        swatchClass: "chart-legend__swatch--reassigned",
    },
    {
        key: "newly_mapped",
        label: "Newly Mapped",
        accessor: (point) => point.newly_ratio,
        lineClass: "chart__line--newly-mapped",
        dotClass: "chart__dot--newly-mapped",
        barClass: "chart__bar--newly-mapped",
        swatchClass: "chart-legend__swatch--newly-mapped",
    },
    {
        key: "unmapped",
        label: "Unmapped",
        accessor: (point) => point.unmapped_ratio,
        lineClass: "chart__line--unmapped",
        dotClass: "chart__dot--unmapped",
        barClass: "chart__bar--unmapped",
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

// Reading order varies by mode. Cumulative leads with Total
// because the aggregate is the headline reading; step omits
// Total entirely because the stack height *is* the total, and
// the legend would otherwise carry a toggle that does nothing.
const READING_ORDER_BY_MODE = {
    cumulative: ["total", "reassigned", "newly_mapped", "unmapped"],
    step: ["reassigned", "newly_mapped", "unmapped"],
};
const SERIES_BY_KEY = Object.fromEntries(SERIES.map((s) => [s.key, s]));
const seriesInReadingOrder = (mode) =>
    READING_ORDER_BY_MODE[mode].map((k) => SERIES_BY_KEY[k]);

// Body copy that the info icon expands. Lives keyed by mode so
// each card carries its own concrete answer to "what is this
// chart showing?" rather than a generic blurb the reader has to
// re-parse. Shared bits (the three category leads, the bridging
// caveat, the legend hint) appear in both but are reworded to
// match each mode's reading order.
const CUMULATIVE_INFO = [
    "How far each build has wandered from the oldest published build with an unfilled variant. Lines grow over time, so a flat segment means the source data did not change against the baseline and a steep slope means it changed fast.",
    {
        lead: "Reassigned.",
        text: "Prefix was mapped in both builds, but now resolves to a different autonomous system. Usually the largest slice; reflects real BGP / RPKI churn.",
    },
    {
        lead: "Newly Mapped.",
        text: "Prefix had no autonomous system in the baseline and now resolves to one. Reflects coverage growth as upstream data adds prefixes.",
    },
    {
        lead: "Unmapped.",
        text: "Prefix that resolved in the baseline no longer resolves. Reflects upstream data dropping prefixes, typically because RPKI / IRR coverage retracted.",
    },
    {
        lead: "Total drift.",
        text: "Sum of the three categories. The headline distance from the baseline build, in a single number, for the build you have selected.",
    },
    "Click any legend entry to hide that line and rescale the chart to whatever stays on. Builds without an unfilled variant carry no dot and the tooltip flags them as having no diff; the line bridges across so the trend stays readable.",
];

const STEP_INFO = [
    "How much each build changed compared to the previous build with an unfilled variant. Each release renders as one stacked bar: a tall bar is a release that moved a lot of prefixes, a flat bar is a quiet release.",
    {
        lead: "Reassigned.",
        text: "Prefix was mapped in both builds, but now resolves to a different autonomous system between the two sides.",
    },
    {
        lead: "Newly Mapped.",
        text: "Prefix that was unmapped in the previous build now resolves to an autonomous system.",
    },
    {
        lead: "Unmapped.",
        text: "Prefix that resolved in the previous build no longer resolves.",
    },
    {
        lead: "Total drift.",
        text: "Height of the full stack. Matches the \"drift vs previous\" number on the overview card for the same pair.",
    },
    "Click any legend entry to hide that category and rescale. Builds without an unfilled variant have no comparable previous build and render as an empty column; the diff is taken against the last build that actually published an unfilled variant.",
];

const MODE_PRESETS = {
    cumulative: {
        title: "Cumulative Drift Since Baseline",
        info: CUMULATIVE_INFO,
        infoAria: "About cumulative drift",
        ariaLabel:
            "Cumulative drift composition since the oldest published build. Reassigned, newly mapped, unmapped, and total drift series.",
    },
    step: {
        title: "Drift Between Builds",
        info: STEP_INFO,
        infoAria: "About per-build drift",
        ariaLabel:
            "Step drift composition between each build and its last diffable predecessor. Reassigned, newly mapped, unmapped, and total drift series.",
    },
};

// Public mount: render one drift card under ``parent`` for the
// requested mode. Cumulative and step are now siblings instead of
// two views behind a toggle, so each call here owns exactly one
// card and one ``hidden`` set. The caller (maps-tab) mounts twice
// to fill both surfaces.
//
//   options.mode      "cumulative" or "step" (required).
//   options.state     { hidden: Set<seriesKey> } persisted across
//                     re-mounts (range-picker swaps). Per-card so
//                     hiding a series in one mode does not yank
//                     it from the other.
//   options.domainStart / options.domainEnd  forwarded to
//                     resolveTimeDomain so the calendar window
//                     matches the other history charts.
export function mount(parent, maps, diffs, options = {}) {
    if (!parent) return;
    const preset = MODE_PRESETS[options.mode];
    if (!preset) {
        throw new Error(`drift-chart: unknown mode ${options.mode}`);
    }
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
    // to act as the anchor; step needs at least two diffable builds.
    // Without those, the chart has no data to plot and we surface
    // the empty state instead of an empty chart card.
    if (!sortedMaps.some((m) => unfilledProfile(m) !== null)) {
        parent.replaceChildren(mutedNote(EMPTY_MESSAGE));
        return;
    }

    const state = options.state ?? { hidden: new Set() };
    if (!state.hidden) state.hidden = new Set();

    const card = document.createElement("article");
    card.className = "card chart-card drift-chart";

    const header = buildHeader(preset);
    const legend = createChartLegend({
        entries: seriesInReadingOrder(options.mode),
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
    // returns a rerender handle the legend toggle callback calls
    // to redraw the SVG without rebuilding the slot.
    const ctrl = mountResponsiveChart(chartSlot, {
        title: null,
        draw: ({ width, height, layout }) =>
            buildChart(
                sortedMaps,
                computePoints(sortedMaps, diffs, options.mode),
                options.mode,
                state.hidden,
                preset.ariaLabel,
                width,
                height,
                layout,
                options,
            ),
    });
}

// ---- Card header (label, info) ----------------------------------

function buildHeader(preset) {
    const header = document.createElement("div");
    header.className = "drift-chart__header";

    const label = document.createElement("span");
    label.className = "card__label uppercase-label";
    label.textContent = preset.title.toUpperCase();
    header.append(label);

    const info = createInfoTooltip({
        body: preset.info,
        ariaLabel: preset.infoAria,
    });
    info.classList.add("drift-chart__info");
    header.append(info);

    return header;
}

// ---- Chart assembly ---------------------------------------------

// Drift-specific assembly: bridge between the (sortedMaps, points)
// pair and the right rendering scaffold for the requested mode.
// Cumulative renders as four overlaid lines (three categories
// plus a dashed Total overlay); step renders as a stacked bar
// per slot whose stack height *is* the total. We share the same
// data layer and the same tooltip builder; only the visual
// scaffold differs.
function buildChart(
    sortedMaps,
    points,
    mode,
    hidden,
    ariaLabel,
    width,
    height,
    layout,
    options,
) {
    // Step never plots a separate Total series — the stack height
    // already carries that reading. Filtering it out here keeps
    // the data layer reusable across modes without leaking
    // ``mode === "step"`` checks into stacked-bar-chart.js.
    const candidates = mode === "step"
        ? SERIES.filter((s) => s.key !== "total")
        : SERIES;
    const visibleSeries = candidates.filter((s) => !hidden.has(s.key));
    if (visibleSeries.length === 0) {
        return mutedNote(
            "All series hidden. Click a legend entry to bring one back.",
        );
    }

    const valueAt = (key, slotIndex) => {
        const point = points[slotIndex];
        if (!point.present) return null;
        return SERIES_BY_KEY[key].accessor(point);
    };

    // Y axis tracks only the visible series. In cumulative this
    // is the largest single ratio; in step it is the largest
    // *stack height* (sum of visible category ratios per slot),
    // so toggling one category off shrinks every bar instead of
    // leaving headroom above the new maximum.
    const yMax = mode === "step"
        ? maxStackHeight(points, visibleSeries)
        : maxSeriesValue(points, visibleSeries);
    if (yMax == null) {
        return mutedNote("No drift data for the picked mode.");
    }

    const spec = {
        timestamps: sortedMaps.map((m) => new Date(m.released_at).getTime()),
        visibleSeries,
        valueAt,
        // niceTicks on a flat-zero domain still needs a non-zero
        // upper bound. 1 % keeps the y axis usable even when
        // every plotted slot happens to be zero.
        yMin: 0,
        yMax: Math.max(0.01, yMax),
        yFormat: (tick) => formatPercent(tick, 0),
        // No y-axis title: the tick labels already carry the "%"
        // suffix, so a rotated "Share" gutter mark would just
        // restate what the ticks say and cost gutter width that
        // the plot can use instead.
        yTitle: null,
        ariaLabel,
        tooltipBodyAt: (slotIndex) =>
            buildTooltipBody({
                title: formatDate(sortedMaps[slotIndex].released_at),
                rows: hoverRows(points[slotIndex], mode),
                footer: footerFor(points[slotIndex], mode),
            }),
    };

    if (mode === "step") {
        return buildStackedBarChart(spec, width, height, layout, options);
    }
    return buildLineChart(spec, width, height, layout, options);
}

// Largest single (point, series) ratio across the visible
// series. Cumulative needs this because each line is plotted
// independently and the y axis has to clear the tallest curve.
function maxSeriesValue(points, visibleSeries) {
    let best = null;
    for (const point of points) {
        if (!point.present) continue;
        for (const series of visibleSeries) {
            const value = series.accessor(point);
            if (value == null) continue;
            if (best == null || value > best) best = value;
        }
    }
    return best;
}

// Largest sum of visible-series ratios across all slots. Step
// stacks categories from the baseline up, so the y axis has to
// clear the tallest *stack*, not the tallest single category.
function maxStackHeight(points, visibleSeries) {
    let best = null;
    for (const point of points) {
        if (!point.present) continue;
        let stack = 0;
        for (const series of visibleSeries) {
            const value = series.accessor(point);
            if (value == null || value <= 0) continue;
            stack += value;
        }
        if (best == null || stack > best) best = stack;
    }
    return best;
}

// Tooltip rows in reading order. Cumulative leads with Total so
// the headline reading sits on top of its three components;
// step leads with the three categories and then surfaces the
// total as a footer-style reading because the stack height is
// what the bar already shows visually.
//
// Every category row is included regardless of whether the user
// hid the matching series, because the underlying data point
// still exists and the tooltip is the inspection surface.
function hoverRows(point, mode) {
    if (!point.present) {
        return [["Drift", "no diff for this build"]];
    }
    const rows = seriesInReadingOrder(mode).map((series) => {
        const pct = formatPercent(series.accessor(point), 1);
        if (series.key === "total") {
            return [series.label, `${pct} (${formatNumber(point.total_changes)})`];
        }
        return [series.label, pct];
    });
    if (mode === "step") {
        const totalPct = formatPercent(point.total_ratio, 1);
        rows.push([
            "Total drift",
            `${totalPct} (${formatNumber(point.total_changes)})`,
        ]);
    }
    return rows;
}

// "since <baseline date>" / "vs <previous date>" tells the reader
// which build the diff is taken against — a real piece of info,
// not a raw filename. When there is no comparable counterpart
// (oldest build for cumulative, or no diffable previous build),
// we return nothing so the tooltip ends after the rows instead
// of carrying a meaningless build identifier.
function footerFor(point, mode) {
    if (!point.present || !point.vs) return null;
    const vsLabel = formatDate(point.vs.released_at);
    return mode === "cumulative" ? `since ${vsLabel}` : `vs ${vsLabel}`;
}
