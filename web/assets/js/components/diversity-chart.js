// Peer bucket diversity chart. Plots one line per build slot
// carrying the count of distinct autonomous systems mapped by
// that build. The number is the per build entry from the
// unfilled (source data) profile so the line reflects real
// upstream routing data and not the fill heuristic.
//
// Why a dedicated chart instead of folding it into drift. Drift
// answers how much address space changed. Diversity answers how
// many peer buckets Bitcoin Core has to work with under the
// asmap based GetGroup() rule. The two signals are independent.
// A diff that reassigns many prefixes between existing ASes
// does not move this line. A diff that adds even one prefix
// mapped to a brand new ASN moves it up by one. Showing both
// lines side by side in the History section is what makes the
// Bitcoin Core peer diversity story end to end.

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
import { createInfoTooltip } from "./info-tooltip.js";

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
        info: createInfoTooltip({
            body: t("history.diversityChart.info"),
            ariaLabel: t("history.diversityChart.infoAria"),
        }),
        draw: ({ width, height, layout }) =>
            buildChart(maps, points, width, height, layout, options),
    });
}

// Anchor the baseline at the oldest build that actually publishes
// an unfilled profile. A filled only build at the head of the
// timeline would otherwise produce a null baseline and the delta
// readings would all collapse to em dashes.
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
    // Pad the y domain by a small fraction of the data range so
    // the topmost dot does not sit on the chart edge. A flat
    // series collapses to a single point with no range, so fall
    // back to plus or minus one bucket which keeps the line
    // visually centred in the plot.
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
