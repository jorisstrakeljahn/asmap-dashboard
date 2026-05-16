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

import { mountResponsiveChart } from "../charts/chart-base.js";
import { buildTooltipBody } from "../charts/chart-tooltip.js";
import { buildLineChart } from "../charts/line-chart.js";
import {
    formatDate,
    formatMegabytes,
    formatNumber,
    formatPercent,
} from "../format.js";
import { mutedNote } from "../utils/dom.js";
import { filledProfile, unfilledProfile } from "../utils/variants.js";
import { createChartLegend } from "./chart-legend.js";
import { createInfoTooltip } from "./info-tooltip.js";

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

const ARIA_LABEL =
    "ASmap file size over time, embedded vs source data variant. Hover the chart for exact values per build.";

export function mount(parent, maps, options = {}) {
    if (!parent) return;
    if (maps.length < 2) {
        parent.replaceChildren();
        return;
    }
    // Toggle state survives across mounts when the caller passes
    // ``options.state``. The legend callback mutates that object
    // in place and asks the chart for a redraw via the rerender
    // handle mountResponsiveChart returns. Falling back to a
    // fresh state keeps the chart usable standalone (e.g. in
    // tests or one-off renders).
    const state = options.state ?? { hidden: new Set() };
    if (!state.hidden) state.hidden = new Set();
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
            buildChart(maps, state.hidden, width, height, layout, options),
    });
}

// Map-size-specific assembly: bridge between the maps array and
// the unified line-chart scaffold. Decides what counts as an
// empty state, then hands a flat spec down for rendering.
function buildChart(maps, hidden, width, height, layout, options) {
    const visibleSeries = SERIES.filter((s) => !hidden.has(s.key));
    if (visibleSeries.length === 0) {
        return mutedNote("All series hidden. Click a legend entry to bring one back.");
    }

    const valueAt = (key, slotIndex) =>
        SERIES.find((s) => s.key === key).profile(maps[slotIndex])
            ?.file_size_bytes ?? null;

    // Y axis tracks only the visible series so toggling the
    // unfilled line off zooms the filled line in (and the other
    // way round). Hidden series stay in the hover tooltip
    // because the data point still exists.
    const visibleValues = visibleSeries.flatMap((series) =>
        maps.map((_, i) => valueAt(series.key, i)).filter((v) => v != null),
    );
    if (visibleValues.length === 0) {
        return mutedNote("No published variants for the loaded builds.");
    }

    return buildLineChart(
        {
            timestamps: maps.map((m) => new Date(m.released_at).getTime()),
            visibleSeries,
            valueAt,
            yMin: Math.min(...visibleValues),
            yMax: Math.max(...visibleValues),
            yFormat: formatMegabytes,
            yTitle: "Megabytes",
            ariaLabel: ARIA_LABEL,
            tooltipBodyAt: (slotIndex) =>
                buildTooltipBody({
                    title: formatDate(maps[slotIndex].released_at),
                    rows: hoverRows(maps[slotIndex]),
                    footer: maps[slotIndex].name,
                }),
        },
        width,
        height,
        layout,
        options,
    );
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
