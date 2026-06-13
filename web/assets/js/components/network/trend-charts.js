// The Network tab's Trends section: four range-windowed charts over the
// snapshot/decay series — the decay curve, the operator breakdown, the
// HHI concentration trend, and the ASmap coverage trend. Extracted from
// network-tab.js so the tab module stays orchestration-only.

import { formatDate } from "../../format.js";
import { t } from "../../utils/i18n.js";
import { MS_PER_DAY } from "../../utils/history-range.js";
import { createModeSwitch } from "../mode-switch.js";
import { mountOperatorsChart } from "./operators-chart.js";
import { mountSeriesChart } from "./series-chart.js";
import {
    buildUnionTimeline,
    sourceLabel,
    sourceSeries,
    toMs,
} from "./series-data.js";
import {
    clampTimeline,
    clampTimelineMax,
    dayUnionTimeline,
} from "./timelines.js";

const SECONDS_PER_DAY = 86400;

// Render all four trend charts for the current range bounds. ``states``
// carries the per-chart toggle state (hidden series, decay axis, HHI
// family); ``rerender`` re-runs this whole pass when a chart's own
// toggle changes.
export function mountTrendCharts(network, sources, bounds, states, rerender) {
    mountDecayChart(network, sources, bounds, states.decay, rerender);
    mountConcentrationChart(network, bounds);
    mountHhiChart(network, sources, bounds, states.hhi, rerender);
    mountCoverageChart(network, sources, bounds, states.coverage);
}

// ---- Decay: drift of today's node set vs each build's age -------

// Two x-axis views over the same curve, switchable in the card header:
//
//   - "age" (default): x is the map's age in days, so the chart reads
//     directly as the answer to the update-cadence question ("how far
//     off is an N-day-old map for today's nodes?"). 0 days sits at the
//     left, the oldest build at the right, drift rises with age.
//   - "date": x is the build's release date, which lines the curve up
//     with the calendar.
//
// Both views honour the 1Y/3Y/5Y/Max range picker, like every other
// trend chart. The age view windows by age rather than by calendar:
// because age = reference − build date, the picker's calendar cutoff
// maps one-to-one onto a maximum map age ("builds from the last year"
// is exactly "ages up to ~365 days"), so the same picker drives both
// axes without a special case the user has to learn.
function mountDecayChart(network, sources, bounds, state, rerender) {
    const referenceTs = network.reference_timestamp;
    const ageMode = state.axis === "age";

    const entries = sources.map((source) => ({
        source,
        points: network.sources[source].decay.points.map((p) => ({
            ts: ageMode ? p.age_days : toMs(p.build_timestamp),
            value: p.drift_pct,
        })),
    }));
    // The age axis has no calendar of its own — age 0 is always the
    // freshest build, no matter when the newest crawl ran. So the picker
    // windows it by age span, not by wall-clock date: "1Y" keeps map ages
    // up to ~365 days, anchored at age 0. The window width is the same
    // 365 / 1095 / 1825 days the date view spans (the "now" terms cancel
    // in domainEnd − cutoff), but here it never shrinks when the crawler
    // pauses — a year of aging is always a full year on screen. "max"
    // (cutoff −Infinity) keeps the whole curve.
    const ageWindowDays =
        bounds.cutoff === -Infinity
            ? Infinity
            : (bounds.domainEnd - bounds.cutoff) / MS_PER_DAY;
    const timeline = ageMode
        ? clampTimelineMax(buildUnionTimeline(entries), ageWindowDays)
        : clampTimeline(buildUnionTimeline(entries), bounds.cutoff);

    const axisToggle = createModeSwitch({
        options: ["age", "date"].map((value) => ({
            value,
            label: t(`network.decay.axis.${value}`),
        })),
        value: state.axis,
        onChange: (next) => {
            state.axis = next;
            rerender();
        },
        ariaLabel: t("network.decay.axis.ariaLabel"),
    });

    mountSeriesChart(document.querySelector("[data-network-decay]"), {
        title: t("network.decay.title"),
        info: t("network.decay.info"),
        infoAria: t("network.decay.infoAria"),
        ariaLabel: t("network.decay.ariaLabel"),
        headerExtra: axisToggle,
        timestamps: timeline.timestamps,
        series: legendSeries(sources),
        valueAt: timeline.valueAt,
        yFormat: formatPercentNumber,
        yFloorZero: true,
        ...(ageMode ? ageAxisSpec(decayAxisMax(timeline.timestamps, bounds)) : {
            domainStart: bounds.domainStart,
            domainEnd: bounds.domainEnd,
        }),
        tooltipTitleAt: (i) =>
            t("network.decay.tooltipTitle", {
                date: formatDate(
                    new Date(
                        ageMode
                            ? toMs(referenceTs - timeline.timestamps[i] * SECONDS_PER_DAY)
                            : timeline.timestamps[i],
                    ),
                ),
                days: ageMode
                    ? timeline.timestamps[i]
                    : ageDays(referenceTs, timeline.timestamps[i]),
            }),
        tooltipRowsAt: (i) =>
            sourceRows(sources, timeline, i, (v) => formatPercentNumber(v)),
        state,
    });
}

// Calendar units for the age axis, largest first. Raw day counts
// (the previous "{days}d") read poorly on a multi-year curve — "1,825d"
// is noise where "5y" is instantly legible. The unit is chosen from the
// span: years past two years, months past a quarter, days below that.
// Steps are calendar-nice within the unit (1/2/5 years, 1/3/6 months)
// rather than the generic 2.5x picker, so ticks land on whole years and
// quarters. The tooltip still carries the exact day count, so precision
// is never lost — only the axis label gets cleaner.
const AGE_AXIS_UNITS = [
    { minDays: 2 * 365, days: 365, steps: [1, 2, 5, 10], labelKey: "tickYears" },
    { minDays: 91, days: 30, steps: [1, 2, 3, 6], labelKey: "tickMonths" },
    { minDays: 0, days: 1, steps: [7, 14, 30, 60, 90], labelKey: "tickDays" },
];

// The age the x axis should span. A bounded range (1Y/3Y/5Y) pins the
// axis to the full window width — 365 / 1095 / 1825 days — so the axis
// reads "1y" / "3y" / "5y" even when a publishing pause leaves the data
// short of the edge, exactly as the date view shows empty space. "max"
// (cutoff −Infinity) spans the real data extent.
function decayAxisMax(ages, bounds) {
    const dataMax = ages.length ? ages[ages.length - 1] : 1;
    if (bounds.cutoff === -Infinity) return Math.max(1, dataMax);
    return (bounds.domainEnd - bounds.cutoff) / MS_PER_DAY;
}

// Numeric x axis for the age view: domain [0, axisMax] with ticks on
// calendar boundaries (whole years / quarters), chosen by decayAxisMax.
function ageAxisSpec(axisMax) {
    const unit = AGE_AXIS_UNITS.find((u) => axisMax >= u.minDays);
    // Aim for ~5 intervals, then round up to the nearest calendar-nice
    // step so a slightly-too-small target never produces a busy axis.
    const target = axisMax / unit.days / 5;
    const step = unit.steps.find((s) => s >= target) ?? unit.steps.at(-1);
    const stepDays = step * unit.days;

    const xTicks = [];
    for (let value = 0; value <= axisMax + stepDays / 2; value += stepDays) {
        if (value > axisMax + 0.5) break;
        xTicks.push({
            timestamp: value,
            label:
                value === 0
                    ? t("network.decay.axis.tickZero")
                    : t(`network.decay.axis.${unit.labelKey}`, {
                          n: Math.round(value / unit.days),
                      }),
        });
    }
    return { linearDomain: true, domainStart: 0, domainEnd: axisMax, xTicks };
}

// ---- AS concentration (HHI) over time ---------------------------

// The headline concentration trend: the same Herfindahl-Hirschman index
// the hero card shows, scored against the build in effect at each
// snapshot. Unlike the per-operator breakdown below (KIT only), HHI is a
// single normalised number comparable across crawlers of different size,
// so this overlays every source — restoring the KIT/Bitnodes
// concentration cross-check the operator view can't make. Two
// independent crawls tracing the same decline is the credibility signal.
// The y-axis auto-scales (no zero floor): HHI lives in a narrow band, so
// flooring at zero would flatten the very trend the chart exists to show.
//
// Points are bucketed by calendar day rather than exact timestamp:
// each crawl runs at its own time of day, so KIT and Bitnodes snapshots
// matched to the same map land hours apart and would otherwise sit on
// adjacent slots with separate hovers. Collapsing them onto one slot
// per day puts both crawlers in a single tooltip; the few-hour shift is
// invisible at the ~monthly snapshot spacing, and genuinely different
// days (the older best-effort matches) still stay apart.
// A family toggle (All / IPv4 / IPv6) sits in the card header:
// Bitcoin Core treats the two families as independent peer-diversity
// dimensions, and the ~80/20 IPv4/IPv6 split means the combined index
// is dominated by IPv4 — the IPv6 view would otherwise be invisible.
function mountHhiChart(network, sources, bounds, state, rerender) {
    const slot = document.querySelector("[data-network-hhi]");
    if (!slot) return;
    const family = state.family ?? "all";
    const entries = sources.map((source) => ({
        source,
        points: network.sources[source].snapshots.map((sn) => ({
            ts: toMs(sn.timestamp),
            value: family === "all" ? sn.hhi : (sn.families?.[family]?.hhi ?? null),
        })),
    }));
    const timeline = clampTimeline(dayUnionTimeline(entries), bounds.cutoff);

    const familyToggle = createModeSwitch({
        options: ["all", "ipv4", "ipv6"].map((value) => ({
            value,
            label: t(`network.familyToggle.${value}`),
        })),
        value: family,
        onChange: (next) => {
            state.family = next;
            rerender();
        },
        ariaLabel: t("network.familyToggle.ariaLabel"),
    });

    mountSeriesChart(slot, {
        title: t("network.hhi.title"),
        info: t("network.hhi.info"),
        infoAria: t("network.hhi.infoAria"),
        ariaLabel: t("network.hhi.ariaLabel"),
        headerExtra: familyToggle,
        timestamps: timeline.timestamps,
        series: legendSeries(sources),
        valueAt: timeline.valueAt,
        yFormat: formatHhi,
        domainStart: bounds.domainStart,
        domainEnd: bounds.domainEnd,
        tooltipTitleAt: (i) => snapshotTitle(timeline, i),
        tooltipRowsAt: (i) => sourceRows(sources, timeline, i, formatHhi),
        state,
    });
}

// ---- ASmap coverage of observed nodes over time ------------------

// The "does the map fit the real network?" series: the share of each
// snapshot's clearnet nodes the build in effect resolves to a real
// AS. A sinking line means kartograf's input data is falling behind
// the network — independent of how the mapped majority distributes,
// which is what HHI above measures.
function mountCoverageChart(network, sources, bounds, state) {
    const slot = document.querySelector("[data-network-coverage]");
    if (!slot) return;
    const entries = sources.map((source) => ({
        source,
        points: network.sources[source].snapshots.map((sn) => ({
            ts: toMs(sn.timestamp),
            value: sn.nodes_clearnet
                ? (100 * sn.mapped) / sn.nodes_clearnet
                : null,
        })),
    }));
    const timeline = clampTimeline(dayUnionTimeline(entries), bounds.cutoff);

    mountSeriesChart(slot, {
        title: t("network.coverage.title"),
        info: t("network.coverage.info"),
        infoAria: t("network.coverage.infoAria"),
        ariaLabel: t("network.coverage.ariaLabel"),
        timestamps: timeline.timestamps,
        series: legendSeries(sources),
        valueAt: timeline.valueAt,
        yFormat: formatCoveragePct,
        // Coverage is a share of the snapshot's nodes: 100% is a hard
        // ceiling, so the axis must not pad past it.
        yCeil: 100,
        domainStart: bounds.domainStart,
        domainEnd: bounds.domainEnd,
        tooltipTitleAt: (i) => snapshotTitle(timeline, i),
        tooltipRowsAt: (i) => sourceRows(sources, timeline, i, formatCoveragePct),
        state,
    });
}

// ---- Operator concentration over time ---------------------------

// The concentration chart is the top-operator breakdown (KIT only):
// stacked vertical bars, one per snapshot, segmented into that
// snapshot's actual top five operators so the stack height is the
// honest per-period CR5 (see operators-chart.js for the full
// rationale). KIT only because it is the live crawl; the
// KIT/Bitnodes cross-check lives in the decay chart above.
//
// Operator breakdown needs KIT, so without it there is nothing to plot
// here and the chart slot stays empty (decay + cross-check still render).
function mountConcentrationChart(network, bounds) {
    const parent = document.querySelector("[data-network-concentration]");
    if (!parent) return;
    if (!network.sources.kit?.snapshots?.length) {
        parent.replaceChildren();
        return;
    }
    mountOperatorsChart(parent, {
        snapshots: network.sources.kit.snapshots,
        bounds,
    });
}

// ---- shared helpers ---------------------------------------------

// Series descriptors for the trend charts, with the Bitnodes legend
// entry suffixed "(archive)" so the frozen line is marked right where
// the reader picks it out. Tooltips and notes keep the plain label.
function legendSeries(sources) {
    return sources.map((source) => {
        const series = sourceSeries(source);
        if (source !== "kit") {
            series.label = t("network.source.archiveLegend", {
                source: series.label,
            });
        }
        return series;
    });
}

function snapshotTitle(timeline, slot) {
    return formatDate(new Date(timeline.timestamps[slot]));
}

// One tooltip row per source that has a value at this slot.
function sourceRows(sources, timeline, slot, format) {
    const rows = [];
    for (const source of sources) {
        const value = timeline.valueAt(source, slot);
        if (value == null) continue;
        rows.push([sourceLabel(source), format(value)]);
    }
    if (rows.length === 0) {
        return [[t("network.noSnapshot"), "\u2014"]];
    }
    return rows;
}

function ageDays(referenceTs, slotMs) {
    const days = (referenceTs - slotMs / 1000) / SECONDS_PER_DAY;
    return Math.max(0, Math.round(days));
}

// drift_pct / share percentages arrive as plain percent numbers (3.8
// -> "3.8%"), unlike format.js formatPercent which expects a 0..1 ratio.
function formatPercentNumber(value) {
    return `${value.toFixed(1)}%`;
}

// HHI is a 0..1 index that lives near 0.02; three decimals keep the
// snapshot-to-snapshot movement legible on the axis and in tooltips.
function formatHhi(value) {
    return value.toFixed(3);
}

// Coverage lives in a narrow band near 98 %; one decimal keeps the
// snapshot-to-snapshot movement legible without implying precision
// the crawl does not have.
function formatCoveragePct(value) {
    return `${value.toFixed(1)}%`;
}
