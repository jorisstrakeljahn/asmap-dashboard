// Generic multi-series time-series card for the Network tab.
//
// Decay, AS concentration, NetGroup diversity, bucketing, and the
// ASN cross-check are all "one line per series over a shared
// timeline" charts that differ only in their value accessor, y
// formatter, and tooltip copy. This module hosts the common card
// chrome (header + info tooltip + clickable legend) and delegates
// the plot to the shared buildLineChart scaffold, the same split
// the Maps tab's drift-chart uses. Each Network chart then shrinks
// to a config object.
//
// Series are toggleable: clicking a legend entry hides its line and
// rescales the y domain to whatever stays visible, so a reader can
// isolate KIT or Bitnodes (or default vs ASmap buckets) without the
// other line compressing the axis.

import { mountResponsiveChart } from "../../charts/chart-base.js";
import { buildTooltipBody } from "../../charts/chart-tooltip.js";
import { buildLineChart } from "../../charts/line-chart.js";
import { mutedNote } from "../../utils/dom.js";
import { t } from "../../utils/i18n.js";
import { createChartLegend } from "../chart-legend.js";
import { createInfoTooltip } from "../info-tooltip.js";

// Fraction of the data range left as breathing room above and below
// the plotted lines so the extreme dots never sit on the card edge.
const Y_PADDING_FRACTION = 0.1;

export function mountSeriesChart(parent, config) {
    if (!parent) return;
    const {
        title,
        info,
        infoAria,
        ariaLabel,
        timestamps,
        series,
        valueAt,
        yFormat,
        yFloorZero = false,
        emptyMessage,
        tooltipTitleAt,
        tooltipRowsAt,
        domainStart = null,
        domainEnd = null,
        state = { hidden: new Set() },
    } = config;

    if (!state.hidden) state.hidden = new Set();

    if (!Array.isArray(timestamps) || timestamps.length === 0) {
        parent.replaceChildren(mutedNote(emptyMessage ?? t("network.empty")));
        return;
    }

    const card = document.createElement("article");
    card.className = "card chart-card network-chart";

    const header = buildHeader(title, info, infoAria);
    const legend = createChartLegend({
        entries: series.map((s) => ({
            key: s.key,
            label: s.label,
            swatchClass: s.swatchClass,
        })),
        hidden: state.hidden,
        onToggle: (key) => {
            if (state.hidden.has(key)) state.hidden.delete(key);
            else state.hidden.add(key);
            ctrl?.rerender();
        },
    });

    const slot = document.createElement("div");
    slot.className = "network-chart__plot";
    card.append(header, legend, slot);
    parent.replaceChildren(card);

    const ctrl = mountResponsiveChart(slot, {
        title: null,
        draw: ({ width, height, layout }) =>
            drawPlot(
                {
                    timestamps,
                    series,
                    valueAt,
                    yFormat,
                    yFloorZero,
                    ariaLabel,
                    tooltipTitleAt,
                    tooltipRowsAt,
                    domainStart,
                    domainEnd,
                    hidden: state.hidden,
                },
                width,
                height,
                layout,
            ),
    });
}

function buildHeader(title, info, infoAria) {
    const header = document.createElement("div");
    header.className = "network-chart__header";

    const label = document.createElement("span");
    label.className = "card__label uppercase-label";
    label.textContent = (title ?? "").toUpperCase();
    header.append(label);

    if (info) {
        const tip = createInfoTooltip({ body: info, ariaLabel: infoAria });
        tip.classList.add("network-chart__info");
        header.append(tip);
    }
    return header;
}

function drawPlot(spec, width, height, layout) {
    const visibleSeries = spec.series.filter((s) => !spec.hidden.has(s.key));
    if (visibleSeries.length === 0) {
        return mutedNote(t("network.allSeriesHidden"));
    }

    const bounds = yBounds(spec, visibleSeries);
    if (bounds == null) {
        return mutedNote(t("network.noData"));
    }

    return buildLineChart(
        {
            timestamps: spec.timestamps,
            visibleSeries,
            valueAt: spec.valueAt,
            yMin: bounds.min,
            yMax: bounds.max,
            yFormat: spec.yFormat,
            yTitle: null,
            ariaLabel: spec.ariaLabel,
            tooltipBodyAt: (i) =>
                buildTooltipBody({
                    title: spec.tooltipTitleAt(i),
                    rows: spec.tooltipRowsAt(i, spec.hidden),
                }),
        },
        width,
        height,
        layout,
        { domainStart: spec.domainStart, domainEnd: spec.domainEnd },
    );
}

// y domain from the visible series only, padded so the extreme dots
// stay off the card border. A flat series (range 0) falls back to
// +/- one unit so the single line sits centred instead of clipped.
function yBounds(spec, visibleSeries) {
    let min = null;
    let max = null;
    for (const series of visibleSeries) {
        for (let i = 0; i < spec.timestamps.length; i++) {
            const value = spec.valueAt(series.key, i);
            if (value == null) continue;
            if (min == null || value < min) min = value;
            if (max == null || value > max) max = value;
        }
    }
    if (min == null) return null;
    const range = max - min;
    const pad = range > 0 ? range * Y_PADDING_FRACTION : 1;
    return {
        min: spec.yFloorZero ? Math.max(0, min - pad) : min - pad,
        max: max + pad,
    };
}
