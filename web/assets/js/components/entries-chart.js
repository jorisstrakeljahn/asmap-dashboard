// Dual-line chart of entries_count over time, one series per
// variant. Answers the coverage question "how many prefix-to-ASN
// mappings does an ASmap build carry?" and absorbs the disk-size
// view: the file_size_bytes the map-size chart used to plot
// tracks entries with sub-percent variance over years (~4 B per
// unfilled entry, ~3.8 B per filled entry), so a second chart
// with the same shape just doubled the cognitive load. The size
// in MB now rides along inside the tooltip next to the entry
// count, so anyone who needs the byte answer still gets it.
//
// Two variants tell different stories:
//
//   - Source data (unfilled) is the raw upstream prefix list. Its
//     entry count grows whenever new prefixes are advertised
//     upstream, so this line tracks real-world coverage growth.
//   - Embedded (filled) is the binary Bitcoin Core ships. The
//     fill heuristic collapses adjacent same-AS prefixes into a
//     single entry, so its count is consistently ~12 % lower than
//     unfilled. The vertical gap between the two lines visualises
//     that compression at a glance.

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
import { filledProfile, unfilledProfile } from "../utils/map-variants.js";
import { createChartLegend } from "./chart-legend.js";
import { createInfoTooltip } from "./info-tooltip.js";

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

const ENTRIES_INFO = [
    "Number of prefix-to-AS entries each ASmap build carries. Tracks coverage growth in absolute terms, alongside the per-release growth bars below.",
    {
        lead: "Source data (unfilled).",
        text: "Raw upstream prefix entries the build was produced from. Grows monotonically as new prefixes are advertised by upstream routing data.",
    },
    {
        lead: "Embedded (filled).",
        text: "Entries after the fill heuristic collapses adjacent same-AS prefixes into single rows. Consistently lower than unfilled; the gap between the two lines visualises the heuristic's compression at a glance.",
    },
    "Hover any build for the entry counts, the matching on-disk size in MB, and the fill-compression ratio between the two variants. Builds that did not publish a variant carry no dot and the tooltip names them as not published, but the line connects the surrounding points so the trend stays readable.",
];

const ARIA_LABEL =
    "ASmap entries count over time, embedded vs source data variant. Hover the chart for exact values per build.";

export function mount(parent, maps, options = {}) {
    if (!parent) return;
    if (maps.length < 2) {
        parent.replaceChildren();
        return;
    }
    const state = options.state ?? { hidden: new Set() };
    if (!state.hidden) state.hidden = new Set();
    let ctrl;
    ctrl = mountResponsiveChart(parent, {
        title: "Source Data Entries Over Time",
        info: createInfoTooltip({
            body: ENTRIES_INFO,
            ariaLabel: "About the entries-over-time chart",
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

function buildChart(maps, hidden, width, height, layout, options) {
    const visibleSeries = SERIES.filter((s) => !hidden.has(s.key));
    if (visibleSeries.length === 0) {
        return mutedNote("All series hidden. Click a legend entry to bring one back.");
    }

    const valueAt = (key, slotIndex) =>
        SERIES.find((s) => s.key === key).profile(maps[slotIndex])
            ?.entries_count ?? null;

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
            yFormat: formatEntriesTick,
            // No y-axis title: the card title, the legend, and the
            // hover tooltip every read "entries", so a rotated
            // "Entries" gutter mark only restates what three
            // labelled neighbours already say.
            yTitle: null,
            ariaLabel: ARIA_LABEL,
            tooltipBodyAt: (slotIndex) =>
                buildTooltipBody({
                    title: formatDate(maps[slotIndex].released_at),
                    rows: hoverRows(maps[slotIndex]),
                }),
        },
        width,
        height,
        layout,
        options,
    );
}

// Y-axis ticks land in the high six figures, so the literal
// number ("412,539") is wider than the gutter can afford. Round
// to whole thousands and append "k" so labels stay short and the
// reader still reads the right order of magnitude.
function formatEntriesTick(value) {
    const abs = Math.abs(value);
    if (abs >= 1000) return `${Math.round(value / 1000)}k`;
    return String(value);
}

function hoverRows(map) {
    const rows = SERIES.map((series) => {
        const profile = series.profile(map);
        if (!profile) return [series.label, "not published"];
        // Entries lead, MB rides in parentheses. Two units, one
        // row, no awkward divider character: the parentheses
        // already read as "the same thing, also expressed as
        // bytes". File size is a near-linear function of the
        // entry count for a given variant (~4 B/entry unfilled,
        // ~3.8 B/entry filled), so showing both is fact rather
        // than redundancy.
        const entries = `${formatNumber(profile.entries_count)} entries`;
        const size = formatMegabytes(profile.file_size_bytes);
        return [series.label, `${entries} (${size})`];
    });

    const filled = filledProfile(map);
    const unfilled = unfilledProfile(map);
    if (filled && unfilled) {
        // Fill compression here is entry-based: how many of the
        // upstream entries the heuristic collapses. The byte
        // compression ratio is similar but not identical because
        // the encoding rewards adjacency differently; entries
        // are what users actually look up, so this is the more
        // meaningful framing.
        const saved = 1 - filled.entries_count / unfilled.entries_count;
        rows.push(["Fill compression", formatPercent(saved, 1)]);
    }
    return rows;
}
