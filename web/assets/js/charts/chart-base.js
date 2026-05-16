// Shared chart scaffolding: builds the card + label + chart slot
// every chart on the dashboard wears, then re-renders the inner
// chart whenever the slot's width changes. Concrete pixel
// dimensions are passed into ``draw`` so the SVG's viewBox can
// match the on-screen size. That keeps axis labels at a real
// pixel size (~11 px) instead of being squashed down to 3-4 px
// when the chart scales below ~400 px wide.

import { svg } from "./svg.js";

// Defaults tuned to look balanced from phone (~320 px) up to the
// dashboard's content max (~1024 px). Each chart can override
// individual fields via the ``layout`` arg if needed.
//
// paddingLeft has to fit the widest y-axis tick. Map size ticks
// like "1.86 MB" are the widest text we draw on the y axis, so
// the gutter has to be wider than the bare "1.86M" needed
// before unit labels existed.
//
// paddingRight is generous on purpose: the rightmost X label uses
// anchor="end" so it sits flush with the plot's right edge, and
// the rightmost data dot still needs a few pixels of gutter so it
// doesn't kiss the card border.
const DEFAULT_LAYOUT = {
    minWidth: 280,
    fallbackWidth: 720,
    height: 240,
    paddingLeft: 60,
    paddingRight: 20,
    paddingTop: 20,
    paddingBottom: 30,
};

// Public: mount a chart card under ``parent`` whose inner SVG
// re-renders whenever the chart's container width changes, or
// whenever the caller asks for it via the returned ``rerender``
// handle (used by clickable legends to redraw after a toggle).
//
//   draw({ width, height, layout }) -> Element
//   info?:   Element built by createInfoTooltip()
//   legend?: () -> Element
//
// ``draw`` is called once synchronously (so the chart is on
// screen before paint) and then on every observed width change.
// ``info`` is optional and pinned to the top-right corner of the
// card, matching the affordance used on overview cards. ``legend``
// is optional and built once at mount time. It sits between the
// title and the chart slot for multi-series charts that need to
// label their lines.
export function mountResponsiveChart(
    parent,
    { title, draw, info, legend, layout = {} },
) {
    if (!parent) return undefined;
    const settings = { ...DEFAULT_LAYOUT, ...layout };

    const card = createChartCard(title);
    if (info) {
        info.classList.add("info-tooltip--card-corner");
        card.root.append(info);
    }
    if (legend) {
        const node = legend();
        if (node) card.root.insertBefore(node, card.slot);
    }
    parent.replaceChildren(card.root);

    let lastWidth = 0;
    // ``force`` lets callers ask for a redraw even when the slot
    // width has not changed (e.g. legend toggles updating series
    // visibility). The width-change branch keeps its sub-pixel
    // skip so scrollbar wobble does not cause repaints.
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

    if (typeof ResizeObserver !== "undefined") {
        new ResizeObserver(() => render()).observe(card.slot);
    } else if (typeof window !== "undefined") {
        window.addEventListener("resize", () => render());
    }

    return { rerender: () => render(true) };
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

// Render each calendar tick as an X-axis label at its scaled X
// position. Every label is centered on its tick so the spacing
// between consecutive labels stays uniform; the previous
// start/end anchoring made the first and last labels visually
// closer to their neighbours than the middle labels were to
// each other. Labels can extend slightly into the left/right
// gutter, which paddingLeft and paddingRight reserve enough
// room for at typical chart widths.
//
// ``ticks`` is the output of pickTimeAxisTicks(): an array of
// ``{ timestamp, label }`` already sorted ascending. Gridlines
// aren't drawn here so each chart can theme them on its own.
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

// Render a small rotated label in the left gutter that names what
// the y axis measures. Sits halfway up the plot and rotates 90°
// counter-clockwise so it reads bottom-to-top - the standard
// convention in scientific and analytics charts. The x coordinate
// sits flush with the SVG's left edge so the tick text (which
// anchors to plot.left - 8) has enough breathing room between it
// and the title.
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

// Snap a millisecond timestamp down to the first day of its month
// in UTC. Used by the history charts so they pin the leftmost
// x-axis label to plot.left: if data starts mid-month, the
// domain extends back to the first of that month so the first
// calendar tick lands on the plot's left edge instead of floating
// 30-60 days inside it.
export function snapToMonthStart(timestampMs) {
    const d = new Date(timestampMs);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

// Resolve the x-axis time domain for a history chart.
// ``options.domainStart`` / ``options.domainEnd`` (typically
// supplied by viewWindow() in utils/maps-view.js) override the
// data-derived bounds, so the calendar window the picker promised
// is honoured even when no build sits at its edge. The start is
// always snapped to the first of its month so the leftmost
// calendar tick lands flush with plot.left.
export function resolveTimeDomain(timestamps, options = {}) {
    const rawStart = options.domainStart ?? timestamps[0];
    const rawEnd = options.domainEnd ?? timestamps[timestamps.length - 1];
    return {
        domainStart: snapToMonthStart(rawStart),
        domainEnd: rawEnd,
    };
}

// Create the SVG root every chart uses. Centralised so the
// viewBox, base class, and accessibility role stay consistent
// across charts and any future chart-wide attribute lands here
// instead of three separate creation sites.
export function createChartSvg(width, height, ariaLabel) {
    const root = svg("svg", {
        viewBox: `0 0 ${width} ${height}`,
        class: "chart",
        role: "presentation",
    });
    if (ariaLabel) root.setAttribute("aria-label", ariaLabel);
    return root;
}

// Calendar-friendly step sizes in months. Picked so a few-month
// range steps up cleanly to a few-year range without producing
// awkward 4- or 5-month intervals that don't read as familiar
// calendar units.
const TIME_STEP_MONTHS = [1, 2, 3, 6, 12, 24];
const AVG_MONTH_MS = 30.44 * 24 * 60 * 60 * 1000;
const MONTH_ABBR = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Pick at most ``maxLabels`` calendar boundaries evenly spaced
// across [startMs, endMs]. Each returned tick lands on the first
// day of a month in UTC, so labels never drift across daylight-
// saving boundaries. The step is the smallest entry in
// TIME_STEP_MONTHS that fits the requested density: wide ranges
// step up to yearly labels (e.g. "2025"), shorter ranges step
// down to monthly labels (e.g. "Jul 25").
//
// Returns ``{ timestamp, label }[]`` sorted ascending.
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

    // First candidate is the start of the start's month. If that
    // falls before the data range (i.e. data starts mid-month),
    // step forward so the first label only appears inside the
    // plotted range and never extends past plot.left.
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

// Pick a comfortable label density based on the chart's pixel
// width. Roughly one label per ~64 px so "Mar 26" / "Aug 25"
// labels don't overlap at 11 px font. The minimum of 3 keeps the
// axis readable even on a 280 px phone.
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
