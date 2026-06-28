// Distinct-operators chart: one line plotting the count of distinct
// operators (ASes) per build, read from the unfilled profile so it
// reflects real upstream routing, not the fill heuristic.
//
// Separate from drift on purpose: drift measures how much address
// space changed, this measures how many distinct operators the map
// can tell apart under the asmap GetGroup() rule. The signals are
// independent - a diff that only reassigns prefixes between existing
// operators leaves this line flat; one new operator moves it by one.

import { mountResponsiveChart } from "../charts/chart-base.js";
import { buildTooltipBody } from "../charts/chart-tooltip.js";
import { buildLineChart } from "../charts/line-chart.js";
import {
    formatCompactCount,
    formatDate,
    formatNumber,
    formatSignedNumber,
} from "../format.js";
import { mutedNote } from "../utils/dom.js";
import { t } from "../utils/i18n.js";
import { unfilledProfile } from "../utils/map-variants.js";

const SERIES_KEY = "ases";

export function mount(parent, maps, options = {}) {
    if (!parent) return;
    if (!Array.isArray(maps) || maps.length < 2) {
        parent.replaceChildren(mutedNote(t("history.diversityChart.empty")));
        return;
    }

    const points = collectPoints(maps);
    if (!points.some((point) => point.value != null)) {
        parent.replaceChildren(mutedNote(t("history.diversityChart.empty")));
        return;
    }

    mountResponsiveChart(parent, {
        title: t("history.diversityChart.title"),
        lede: t("history.diversityChart.lede"),
        draw: ({ width, height, layout }) =>
            buildChart(maps, points, width, height, layout, options),
    });
}

// Anchor the baseline at the oldest build that publishes an
// unfilled profile. A filled-only build at the head would yield a
// null baseline and collapse every delta reading to an em dash.
function collectPoints(maps) {
    let baseline = null;
    return maps.map((map) => {
        const profile = unfilledProfile(map);
        const value = profile?.unique_asns ?? null;
        if (value != null && baseline == null) {
            baseline = { value, released_at: map.released_at };
        }
        const baselineValue = baseline ? baseline.value : null;
        return {
            map,
            value,
            baseline,
            deltaSinceBaseline:
                value != null && baselineValue != null
                    ? value - baselineValue
                    : null,
        };
    });
}

function buildChart(maps, points, width, height, layout, options) {
    const values = points
        .map((point) => point.value)
        .filter((value) => value != null);
    if (!values.length) {
        return mutedNote(t("history.diversityChart.empty"));
    }

    const yMin = Math.min(...values);
    const yMax = Math.max(...values);
    const range = yMax - yMin;
    // Pad the y domain by a fraction of the range so the top dot
    // does not sit on the edge. A flat series has no range, so fall
    // back to +/- one operator to keep the line centred.
    const padding = range > 0 ? range * 0.1 : 1;

    return buildLineChart(
        {
            timestamps: maps.map((map) => new Date(map.released_at).getTime()),
            visibleSeries: [
                {
                    key: SERIES_KEY,
                    label: t("history.diversityChart.asesLabel"),
                    lineClass: "chart__line--reassigned",
                    dotClass: "chart__dot--reassigned",
                },
            ],
            valueAt: (_key, slotIndex) => points[slotIndex].value,
            yMin: Math.max(0, yMin - padding),
            yMax: yMax + padding,
            yFormat: formatCompactCount,
            yTitle: null,
            ariaLabel: t("history.diversityChart.ariaLabel"),
            tooltipBodyAt: (slotIndex) =>
                buildTooltipBody({
                    title: formatDate(maps[slotIndex].released_at),
                    rows: hoverRows(points[slotIndex]),
                    footer: footerFor(points[slotIndex]),
                }),
        },
        width,
        height,
        layout,
        options,
    );
}

function hoverRows(point) {
    if (point.value == null) {
        return [
            [
                t("history.diversityChart.asesLabel"),
                t("history.entriesChart.notPublished"),
            ],
        ];
    }
    return [
        [
            t("history.diversityChart.asesLabel"),
            formatNumber(point.value),
        ],
    ];
}

function footerFor(point) {
    if (
        point.value == null ||
        point.deltaSinceBaseline == null ||
        !point.baseline ||
        point.map.released_at === point.baseline.released_at
    ) {
        return null;
    }
    return t("history.diversityChart.appearedSinceBaseline", {
        count: formatSignedNumber(point.deltaSinceBaseline),
        date: formatDate(point.baseline.released_at),
    });
}
