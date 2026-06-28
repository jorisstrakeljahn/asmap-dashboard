// Shared chart scaffolding: builds the card + label + chart slot and
// re-renders the inner chart on slot width changes. Pixel dimensions are passed
// into ``draw`` so the SVG's viewBox matches the on-screen size, keeping axis
// labels at ~11 px instead of being squashed to 3-4 px below ~400 px wide.

import { svg } from "./svg.js";
import { createChartLede } from "../components/chart-lede.js";

// Defaults tuned from phone (~320 px) to content max (~1024 px); each chart
// overrides via `layout`. paddingLeft fits the widest y-tick ("460k" in ~48 px
// incl. the 8 px gap to plot.left); paddingRight keeps the end-anchored last X
// label flush with the plot edge and the last dot off the border.
const DEFAULT_LAYOUT = {
    minWidth: 280,
    fallbackWidth: 720,
    height: 240,
    paddingLeft: 48,
    paddingRight: 20,
    paddingTop: 20,
    paddingBottom: 30,
};

// Registry of every mounted chart's width-watcher. A re-mount detaches the old
// slot, but its ResizeObserver/resize listener would keep firing render()
// against the dead node forever; sweeping detached slots on each new mount
// disconnects those orphans so watchers never accumulate.
const liveCharts = new Set();

function sweepDetachedCharts() {
    for (const entry of liveCharts) {
        if (!entry.slot.isConnected) {
            entry.teardown();
            liveCharts.delete(entry);
        }
    }
}

// Mount a chart card under `parent` whose inner SVG re-renders on width
// changes, or when the returned `rerender` handle fires (clickable legends).
// `draw` runs once synchronously (chart on screen before paint), then on every
// observed width change.
//
//   draw({ width, height, layout }) -> Element
//   lede?:   short summary shown below the title, always visible
//   legend?: () -> Element, built once between title and slot
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
    // ``force`` redraws even when width is unchanged (e.g. legend toggles).
    // The width-change branch keeps a sub-pixel skip so scrollbar wobble
    // doesn't cause repaints.
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
        // Drop the width watcher explicitly. The detached-slot sweep on the
        // next mount covers the usual re-mount path, so most callers never
        // need this.
        destroy: () => {
            teardown();
            liveCharts.delete(entry);
        },
    };
}

// title optional: callers with their own card chrome pass null for just the
// slot; a string renders the standard card label.
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

// Y axis: a gridline at every tick plus a right-aligned label in the gutter.
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

// X-axis labels, centered on their tick for uniform spacing (start/end
// anchoring crowded the first and last). Labels may spill into the gutters,
// which paddingLeft/Right reserve room for. `ticks` is pickTimeAxisTicks()
// output. Gridlines aren't drawn here so each chart can theme them.
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

// Small rotated y-axis title in the left gutter, halfway up the plot, 90° CCW
// to read bottom-to-top. Flush with the SVG's left edge so the tick text
// (anchored at plot.left - 8) keeps breathing room.
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

// Snap a ms timestamp down to the first of its month (UTC). Pins the leftmost
// x-label to plot.left: mid-month data extends the domain back to the first, so
// the first tick lands on the edge instead of floating 30-60 days inside it.
export function snapToMonthStart(timestampMs) {
    const d = new Date(timestampMs);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

// X-axis time domain for a history chart. options.domainStart/End (from
// resolveHistoryRange) override the data-derived bounds, so the picker's window
// is honoured even when no build sits at its edge. Start snaps to month-first.
export function resolveTimeDomain(timestamps, options = {}) {
    const rawStart = options.domainStart ?? timestamps[0];
    const rawEnd = options.domainEnd ?? timestamps[timestamps.length - 1];
    return {
        domainStart: snapToMonthStart(rawStart),
        domainEnd: rawEnd,
    };
}

export function createChartSvg(width, height, ariaLabel) {
    // Labelled chart -> role="img" + aria-label (announceable). Unlabelled ->
    // role="presentation" (decorative; the card carries the meaning). The two
    // are mutually exclusive: a presentation node drops its aria-label.
    const root = svg("svg", {
        viewBox: `0 0 ${width} ${height}`,
        class: "chart",
        role: ariaLabel ? "img" : "presentation",
    });
    if (ariaLabel) root.setAttribute("aria-label", ariaLabel);
    return root;
}

// Calendar-friendly step sizes in months, chosen to avoid awkward 4- or
// 5-month intervals that don't read as familiar units.
const TIME_STEP_MONTHS = [1, 2, 3, 6, 12, 24];
const AVG_MONTH_MS = 30.44 * 24 * 60 * 60 * 1000;
const MONTH_ABBR = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// At most `maxLabels` calendar boundaries across [startMs, endMs]. Each tick is
// the first of a month in UTC, so labels never drift across DST. The step is
// the smallest TIME_STEP_MONTHS entry that fits the density: wide ranges go
// yearly ("2025"), shorter ones monthly ("Jul 25").
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

    // First candidate is the start of the start's month. If it falls before
    // the data range (data starts mid-month), step forward so the first label
    // stays inside the plotted range.
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

// Label density from pixel width: ~one label per 64 px so labels don't overlap
// at 11 px font. The minimum of 3 keeps the axis readable on a 280 px phone.
const LABEL_SLOT_PX = 64;
const MIN_LABELS = 3;
export function labelDensityForWidth(width) {
    return Math.max(MIN_LABELS, Math.floor(width / LABEL_SLOT_PX));
}

// Inner plot rectangle from outer dimensions + padding, shared so charts can't
// drift apart on gutter math.
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
