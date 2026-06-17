// Tooltip copy for the drift chart: per-category hover rows and the
// "compared against" footer. Split out of drift-chart.js to keep
// that module on data and assembly.
//
// ``series`` is the full reading-order list (resolved labels);
// hidden categories still show in the tooltip, so the caller passes
// the unfiltered list, not the visible subset.

import { formatCoverage, formatDate, formatPercent } from "../format.js";
import { t } from "../utils/i18n.js";

// Reading order: cumulative leads with Total; step shows it as a
// footer since the stack height already conveys it. The Total row
// appends a family-aware count: IPv4 as raw addresses, IPv6 as /32
// NetGroup blocks so the cell never becomes a 30-digit decimal that
// overflows the tooltip.
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

// Step mode names the gap to the compared build in the footer: the
// bars are not time-normalised, so a tall bar after a long pause is
// mostly accumulated time, not a routing event. "147 days earlier"
// gives the reader the denominator to judge the height.
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
