// Shared chart scaffolding: builds the card + label + chart slot
// and re-renders the inner chart on slot width changes. Pixel
// dimensions are passed into ``draw`` so the SVG's viewBox matches
// the on-screen size, keeping axis labels at ~11 px instead of
// being squashed to 3-4 px below ~400 px wide.

import { svg } from "./svg.js";
import { createChartLede } from "../components/chart-lede.js";

// Defaults tuned from phone (~320 px) to the dashboard's content
// max (~1024 px); each chart can override fields via ``layout``.
//
// paddingLeft fits the widest y-axis tick label across charts,
// topping out at four chars like "460k" in ~48 px (incl. the 8 px
// gap to plot.left). No chart draws a rotated gutter title, so the
// gutter only needs room for ticks.
//
// paddingRight is generous so the rightmost X label (anchor="end")
// sits flush with the plot edge and the rightmost dot keeps a few
// pixels off the card border.
const DEFAULT_LAYOUT = {
    minWidth: 280,
    fallbackWidth: 720,
    height: 240,
    paddingLeft: 48,
    paddingRight: 20,
    paddingTop: 20,
    paddingBottom: 30,
};

// Registry of every mounted chart's width-watcher. A re-mount (tab /
// range / family switch) detaches the old slot, but its
// ResizeObserver / resize listener would keep firing render() against
// the detached node forever. Sweeping the registry for detached slots
// on each new mount disconnects those orphans so watchers never
// accumulate.
const liveCharts = new Set();

function sweepDetachedCharts() {
    for (const entry of liveCharts) {
        if (!entry.slot.isConnected) {
            entry.teardown();
            liveCharts.delete(entry);
        }
    }
}

// Public: mount a chart card under ``parent`` whose inner SVG
// re-renders on container width changes, or when the caller invokes
// the returned ``rerender`` handle (used by clickable legends).
//
//   draw({ width, height, layout }) -> Element
//   lede?:   short summary shown below the title, always visible
//   legend?: () -> Element, built once between title and slot
//
// ``draw`` runs once synchronously (chart on screen before paint)
// and then on every observed width change.
export function mountResponsiveChart(
    parent,
    { title, draw, lede, legend, layout = {} },
) {
    if (!parent) return undefined;
    // Drop watchers whose slot this (or a sibling) re-mount just detached.
    sweepDetachedCharts();

    const settings = { ...DEFAULT_LAYOUT, ...layout };

    const card = createChartCard(title);
    // Lede sits directly under the title label, above the legend.
    if (lede) card.root.insertBefore(createChartLede(lede), card.slot);
    if (legend) {
        const node = legend();
        if (node) card.root.insertBefore(node, card.slot);
    }
    parent.replaceChildren(card.root);

    let lastWidth = 0;
    // ``force`` redraws even when width is unchanged (e.g. legend
    // toggles). The width-change branch keeps a sub-pixel skip so
    // scrollbar wobble doesn't cause repaints.
    const render = (force = false) => {
        const measured = card.slot.clientWidth || settings.fallbackWidth;
        const width = Math.max(settings.minWidth, measured);
        if (!force && Math.abs(width - lastWidth) < 1) return;
        lastWidth = width;
        card.slot.replaceChildren(
            draw({ width, height: settings.height, layout: settings }),
        );
    };

    render();

    let teardown = () => {};
    if (typeof ResizeObserver !== "undefined") {
        const observer = new ResizeObserver(() => render());
        observer.observe(card.slot);
        teardown = () => observer.disconnect();
    } else if (typeof window !== "undefined") {
        const onResize = () => render();
        window.addEventListener("resize", onResize);
        teardown = () => window.removeEventListener("resize", onResize);
    }

    const entry = { slot: card.slot, teardown };
    liveCharts.add(entry);

    return {
        rerender: () => render(true),
        // Drop the width watcher explicitly. The detached-slot sweep on
        // the next mount covers the usual re-mount path, so most callers
        // never need this.
        destroy: () => {
            teardown();
            liveCharts.delete(entry);
        },
    };
}

// ``title`` is optional: callers wrapping the chart in their own
// card chrome pass null to get just the slot; a string renders the
// standard card label.
function createChartCard(title) {
    const root = document.createElement("article");
    root.className = "card chart-card";

    const slot = document.createElement("div");
    slot.className = "chart-slot";

    if (title) {
        const label = document.createElement("span");
        label.className = "card__label uppercase-label";
        label.textContent = title.toUpperCase();
        root.append(label);
    }
    root.append(slot);
    return { root, slot };
}

// Axis helpers --------------------------------------------------

// Draw the Y axis: a horizontal gridline at every tick plus a
// right-aligned label sitting in the left gutter.
export function renderYAxis(root, ticks, yScale, { plotLeft, plotRight, format }) {
    for (const tick of ticks) {
        const y = yScale(tick);
        root.append(
            svg("line", {
                x1: plotLeft,
                x2: plotRight,
                y1: y,
                y2: y,
                class: "chart__grid",
            }),
            svgText({
                x: plotLeft - 8,
                y: y + 4,
                anchor: "end",
                className: "chart__y-label",
                text: format(tick),
            }),
        );
    }
}

// Render each calendar tick as an X-axis label at its scaled X.
// Labels are centered on their tick for uniform spacing (the old
// start/end anchoring crowded the first and last labels). Labels
// may extend slightly into the gutters, which paddingLeft/Right
// reserve room for.
//
// ``ticks`` is pickTimeAxisTicks() output: ``{ timestamp, label }``
// sorted ascending. Gridlines aren't drawn here so each chart can
// theme them.
export function renderTimeAxis(root, ticks, xScale, plotBottom) {
    if (ticks.length === 0) return;
    for (let i = 0; i < ticks.length; i++) {
        root.append(
            svgText({
                x: xScale(ticks[i].timestamp),
                y: plotBottom + 16,
                anchor: "middle",
                className: "chart__x-label",
                text: ticks[i].label,
            }),
        );
    }
}

// Render a small rotated label in the left gutter naming what the
// y axis measures. Sits halfway up the plot, rotated 90° CCW to
// read bottom-to-top (the usual chart convention). Its x sits flush
// with the SVG's left edge so the tick text (anchored at
// plot.left - 8) has breathing room.
export function renderYAxisTitle(root, text, plot) {
    if (!text) return;
    const x = 8;
    const y = (plot.top + plot.bottom) / 2;
    const label = svgText({
        x,
        y,
        anchor: "middle",
        className: "chart__y-title",
        text,
    });
    label.setAttribute("transform", `rotate(-90 ${x} ${y})`);
    root.append(label);
}

// Snap a millisecond timestamp down to the first of its month in
// UTC. History charts use this to pin the leftmost x-axis label to
// plot.left: data starting mid-month extends the domain back to the
// first, so the first tick lands on the left edge instead of
// floating 30-60 days inside it.
export function snapToMonthStart(timestampMs) {
    const d = new Date(timestampMs);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

// Resolve the x-axis time domain for a history chart.
// ``options.domainStart`` / ``options.domainEnd`` (typically from
// resolveHistoryRange() in utils/history-range.js) override the
// data-derived bounds, so the picker's calendar window is honoured
// even when no build sits at its edge. The start is snapped to the
// first of its month so the leftmost tick sits flush with plot.left.
export function resolveTimeDomain(timestamps, options = {}) {
    const rawStart = options.domainStart ?? timestamps[0];
    const rawEnd = options.domainEnd ?? timestamps[timestamps.length - 1];
    return {
        domainStart: snapToMonthStart(rawStart),
        domainEnd: rawEnd,
    };
}

// Create the SVG root every chart uses. Centralised so viewBox,
// base class, and accessibility role stay consistent and any future
// chart-wide attribute lands in one place.
export function createChartSvg(width, height, ariaLabel) {
    // A labelled chart is announceable: role="img" + aria-label.
    // Without a label it is decorative scaffolding (the card carries
    // the meaning) and stays role="presentation" — combining the two
    // is contradictory, as a presentation node drops its aria-label.
    const root = svg("svg", {
        viewBox: `0 0 ${width} ${height}`,
        class: "chart",
        role: ariaLabel ? "img" : "presentation",
    });
    if (ariaLabel) root.setAttribute("aria-label", ariaLabel);
    return root;
}

// Calendar-friendly step sizes in months, chosen to avoid awkward
// 4- or 5-month intervals that don't read as familiar units.
const TIME_STEP_MONTHS = [1, 2, 3, 6, 12, 24];
const AVG_MONTH_MS = 30.44 * 24 * 60 * 60 * 1000;
const MONTH_ABBR = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Pick at most ``maxLabels`` calendar boundaries evenly spaced
// across [startMs, endMs]. Each tick lands on the first of a month
// in UTC, so labels never drift across DST boundaries. The step is
// the smallest TIME_STEP_MONTHS entry that fits the density: wide
// ranges step up to yearly labels ("2025"), shorter ranges down to
// monthly ("Jul 25"). Returns ``{ timestamp, label }[]`` ascending.
export function pickTimeAxisTicks(startMs, endMs, maxLabels = 5) {
    if (!(endMs > startMs)) return [];
    const totalMonths = (endMs - startMs) / AVG_MONTH_MS;
    const minStep = totalMonths / Math.max(1, maxLabels);
    const step = TIME_STEP_MONTHS.find((s) => s >= minStep)
              || TIME_STEP_MONTHS.at(-1);
    const useYearLabel = step >= 12;

    const startDate = new Date(startMs);
    const baseYear = startDate.getUTCFullYear();
    let monthOffset = startDate.getUTCMonth();

    // First candidate is the start of the start's month. If it falls
    // before the data range (data starts mid-month), step forward so
    // the first label stays inside the plotted range.
    let cursor = Date.UTC(baseYear, monthOffset, 1);
    if (cursor < startMs) {
        monthOffset += step;
        cursor = Date.UTC(baseYear, monthOffset, 1);
    }

    const ticks = [];
    while (cursor <= endMs) {
        const d = new Date(cursor);
        const label = useYearLabel
            ? String(d.getUTCFullYear())
            : `${MONTH_ABBR[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(-2)}`;
        ticks.push({ timestamp: cursor, label });
        monthOffset += step;
        cursor = Date.UTC(baseYear, monthOffset, 1);
    }
    return ticks;
}

// Label density from pixel width: ~one label per 64 px so labels
// don't overlap at 11 px font. The minimum of 3 keeps the axis
// readable on a 280 px phone.
const LABEL_SLOT_PX = 64;
const MIN_LABELS = 3;
export function labelDensityForWidth(width) {
    return Math.max(MIN_LABELS, Math.floor(width / LABEL_SLOT_PX));
}

// Compute the inner plot rectangle from outer dimensions plus
// padding. Centralised so charts can't drift apart on gutter math.
export function plotBounds(width, height, { paddingLeft, paddingRight, paddingTop, paddingBottom }) {
    return {
        left: paddingLeft,
        right: width - paddingRight,
        top: paddingTop,
        bottom: height - paddingBottom,
    };
}

function svgText({ x, y, anchor, className, text }) {
    const node = svg("text", {
        x,
        y,
        class: className,
        "text-anchor": anchor,
    });
    node.textContent = text;
    return node;
}
