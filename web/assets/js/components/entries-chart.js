// Dual-line entries-over-time chart (one line per variant). The
// file_size_bytes view tracks entries with sub-percent variance
// (~4 B / entry), so rather than a separate chart the size in MB
// rides along inside the tooltip.

import { mountResponsiveChart } from "../charts/chart-base.js";
import { buildTooltipBody } from "../charts/chart-tooltip.js";
import { buildLineChart } from "../charts/line-chart.js";
import {
    formatCompactCount,
    formatDate,
    formatMegabytes,
    formatNumber,
    formatPercent,
} from "../format.js";
import { mutedNote } from "../utils/dom.js";
import { t } from "../utils/i18n.js";
import { filledProfile, unfilledProfile } from "../utils/map-variants.js";
import { createChartLegend } from "./chart-legend.js";

const SERIES = [
    {
        key: "unfilled",
        labelKey: "common.variants.unfilled",
        lineClass: "chart__line--unfilled",
        dotClass: "chart__dot--unfilled",
        swatchClass: "chart-legend__swatch--unfilled",
        profile: unfilledProfile,
    },
    {
        key: "filled",
        labelKey: "common.variants.filled",
        lineClass: "chart__line--filled",
        dotClass: "chart__dot--filled",
        swatchClass: "chart-legend__swatch--filled",
        profile: filledProfile,
    },
];

// Resolve labelKey at call time so legend / tooltip pick up
// locale changes without rebuilding SERIES.
const seriesForRender = () =>
    SERIES.map((s) => ({ ...s, label: t(s.labelKey) }));

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
        title: t("history.entriesChart.title"),
        lede: t("history.entriesChart.lede"),
        legend: () =>
            createChartLegend({
                entries: seriesForRender(),
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
    const series = seriesForRender();
    const visibleSeries = series.filter((s) => !hidden.has(s.key));
    if (visibleSeries.length === 0) {
        return mutedNote(t("history.allSeriesHidden"));
    }

    const valueAt = (key, slotIndex) =>
        series.find((s) => s.key === key).profile(maps[slotIndex])
            ?.entries_count ?? null;

    const visibleValues = visibleSeries.flatMap((s) =>
        maps.map((_, i) => valueAt(s.key, i)).filter((v) => v != null),
    );
    if (visibleValues.length === 0) {
        return mutedNote(t("history.entriesChart.noPublishedVariants"));
    }

    return buildLineChart(
        {
            timestamps: maps.map((m) => new Date(m.released_at).getTime()),
            visibleSeries,
            valueAt,
            yMin: Math.min(...visibleValues),
            yMax: Math.max(...visibleValues),
            yFormat: formatCompactCount,
            yTitle: null,
            ariaLabel: t("history.entriesChart.ariaLabel"),
            tooltipBodyAt: (slotIndex) =>
                buildTooltipBody({
                    title: formatDate(maps[slotIndex].released_at),
                    rows: hoverRows(maps[slotIndex], series),
                }),
        },
        width,
        height,
        layout,
        options,
    );
}

function hoverRows(map, series) {
    const rows = series.map((s) => {
        const profile = s.profile(map);
        if (!profile) return [s.label, t("history.entriesChart.notPublished")];
        return [
            s.label,
            t("history.entriesChart.entriesAndSize", {
                count: formatNumber(profile.entries_count),
                size: formatMegabytes(profile.file_size_bytes),
            }),
        ];
    });

    const filled = filledProfile(map);
    const unfilled = unfilledProfile(map);
    if (filled && unfilled) {
        // Entry-based, not byte-based: entries are what users
        // actually look up.
        const saved = 1 - filled.entries_count / unfilled.entries_count;
        rows.push([
            t("history.entriesChart.fillCompressionLabel"),
            formatPercent(saved, 1),
        ]);
    }
    return rows;
}
