// Tooltip copy for the drift chart: the per-category hover rows and
// the "compared against" footer. Split out of drift-chart.js so that
// module keeps to the chart's data model and assembly while the
// human-facing formatting lives on its own.
//
// ``series`` is the full reading-order list (with resolved labels);
// hidden categories still appear in the tooltip, so the caller passes
// the unfiltered list, not the visible subset.

import { formatCoverage, formatDate, formatPercent } from "../format.js";
import { t } from "../utils/i18n.js";

// Reading order: cumulative leads with Total. Step surfaces it as a
// footer because the stack height already conveys it. The Total row
// appends a family-aware count so the hover reading names what the
// percentage was computed against: IPv4 as raw addresses, IPv6 as /32
// NetGroup blocks so the cell never grows into a 30-digit decimal that
// would push the tooltip past the chart edge.
export function driftHoverRows(point, series, mode, family, unitCountSuffix) {
    const totalLabel = t("history.driftSeries.total");
    if (!point.present) {
        return [[totalLabel, t("history.driftSeries.noDiff")]];
    }
    const rows = series.map((s) => {
        if (s.key === "total") {
            return [s.label, formatTotalCell(point, family, unitCountSuffix)];
        }
        return [s.label, formatPercent(s.accessor(point), 1)];
    });
    if (mode === "step") {
        rows.push([totalLabel, formatTotalCell(point, family, unitCountSuffix)]);
    }
    return rows;
}

function formatTotalCell(point, family, unitCountSuffix) {
    return t("history.driftSeries.totalWithCount", {
        pct: formatPercent(point.total_ratio, 1),
        count: formatCoverage(point.total_changes, family),
        unit: unitCountSuffix,
    });
}

// Step mode names the gap to the compared build right in the footer:
// the bars are not time-normalised, so a tall bar after a five-month
// publishing pause is mostly accumulated time, not a routing event.
// Spelling out "147 days earlier" hands the reader the denominator
// they need to judge the bar's height.
export function driftFooter(point, mode, currentReleasedAt) {
    if (!point.present || !point.vs) return null;
    const date = formatDate(point.vs.released_at);
    if (mode === "cumulative") {
        return t("history.driftSeries.sinceDate", { date });
    }
    const days = gapDays(point.vs.released_at, currentReleasedAt);
    return days > 0
        ? t("history.driftSeries.vsDateWithGap", { date, days })
        : t("history.driftSeries.vsDate", { date });
}

function gapDays(fromIso, toIso) {
    const from = Date.parse(fromIso);
    const to = Date.parse(toIso);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
    return Math.max(0, Math.round((to - from) / 86_400_000));
}
