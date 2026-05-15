// Shared chart scaffolding: builds the card + label + chart slot
// every chart on the dashboard wears, then re-renders the inner
// chart whenever the slot's width changes. Concrete pixel
// dimensions are passed into ``draw`` so the SVG's viewBox can
// match the on-screen size; that keeps axis labels at a real
// pixel size (~11 px) instead of being squashed down to 3-4 px
// when the chart scales below ~400 px wide.

import { svg } from "./svg.js";

// Defaults tuned to look balanced from phone (~320 px) up to the
// dashboard's content max (~1024 px). Each chart can override
// individual fields via the ``layout`` arg if needed.
//
// paddingRight is generous on purpose: the rightmost X label uses
// anchor="end" so it sits flush with the plot's right edge, and
// the rightmost data dot still needs a few pixels of gutter so it
// doesn't kiss the card border.
const DEFAULT_LAYOUT = {
    minWidth: 280,
    fallbackWidth: 720,
    height: 240,
    paddingLeft: 44,
    paddingRight: 20,
    paddingTop: 20,
    paddingBottom: 30,
};

// Public: mount a chart card under ``parent`` whose inner SVG
// re-renders whenever the chart's container width changes.
//
//   draw({ width, height, layout }) -> Element
//
// ``draw`` is called once synchronously (so the chart is on
// screen before paint) and then on every observed width change.
export function mountResponsiveChart(parent, { title, draw, layout = {} }) {
    if (!parent) return;
    const settings = { ...DEFAULT_LAYOUT, ...layout };

    const card = createChartCard(title);
    parent.replaceChildren(card.root);

    let lastWidth = 0;
    const render = () => {
        const measured = card.slot.clientWidth || settings.fallbackWidth;
        const width = Math.max(settings.minWidth, measured);
        // Skip sub-pixel changes — they happen on scrollbar
        // toggles and would otherwise cause unnecessary repaints.
        if (Math.abs(width - lastWidth) < 1) return;
        lastWidth = width;
        card.slot.replaceChildren(
            draw({ width, height: settings.height, layout: settings }),
        );
    };

    render();

    if (typeof ResizeObserver !== "undefined") {
        new ResizeObserver(render).observe(card.slot);
    } else if (typeof window !== "undefined") {
        window.addEventListener("resize", render);
    }
}

// ``title`` is optional: callers that wrap the chart in their own
// custom card chrome (drift chart, future composite charts) pass
// null to get just the slot, while the standard card label is
// rendered when a title string is supplied.
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

// Draw the X axis labels at the picked indices. The first and
// last labels anchor to the plot's edge ("start" / "end") instead
// of being centered on it, so the bookend dates always render
// fully inside the chart and never get clipped at the card edge.
// Chart-specific gridlines / cursors are the chart's own
// responsibility, so we don't draw vertical lines here.
export function renderXAxis(root, indices, xAt, plotBottom, format) {
    if (indices.length === 0) return;
    const firstIdx = indices[0];
    const lastIdx = indices[indices.length - 1];
    for (const idx of indices) {
        let anchor = "middle";
        if (idx === firstIdx) anchor = "start";
        else if (idx === lastIdx) anchor = "end";
        root.append(
            svgText({
                x: xAt(idx),
                y: plotBottom + 16,
                anchor,
                className: "chart__x-label",
                text: format(idx),
            }),
        );
    }
}

// Pick at most ``maxLabels`` indices spaced evenly across the
// data range. Endpoints are always included so the time range's
// start and end are visible.
export function pickAxisLabelIndices(count, maxLabels = 5) {
    if (count <= maxLabels) return [...Array(count).keys()];
    const last = count - 1;
    const stops = maxLabels - 1;
    return Array.from(
        { length: maxLabels },
        (_, i) => Math.round((last * i) / stops),
    );
}

// Pick a comfortable label density based on the chart's pixel
// width. Roughly one label per ~64 px so "Mar 26" / "Aug 25"
// labels don't overlap at 11 px font. The minimum of 3 keeps the
// axis readable even on a 280 px phone; the count is capped only
// by the caller's data length via pickAxisLabelIndices.
const LABEL_SLOT_PX = 64;
const MIN_LABELS = 3;
export function labelDensityForWidth(width) {
    return Math.max(MIN_LABELS, Math.floor(width / LABEL_SLOT_PX));
}

// Compute the inner plot rectangle from outer dimensions plus
// padding. Centralised so individual charts can't drift apart on
// the gutter math.
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
