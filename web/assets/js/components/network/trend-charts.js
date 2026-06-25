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
    SOURCE_ORDER,
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

// Create a header mode-switch once and cache it on the chart's
// persistent ``state`` bag. mountSeriesChart rebuilds the card on every
// re-render; recreating the switch each time would snap its pill to the
// new position with no transition. Reusing the instance lets it be
// re-parented mid-slide, so the highlight animates on click.
function ensureToggle(state, factory) {
    if (!state.toggle) state.toggle = factory();
    return state.toggle;
}

// Render all four trend charts for the current range bounds. ``states``
// carries the per-chart toggle state (hidden series, decay axis, HHI
// family); ``rerender`` re-runs this whole pass when a chart's own
// toggle changes.
export function mountTrendCharts(network, sources, bounds, states, rerender) {
    mountDecayChart(network, sources, bounds, states.decay, rerender);
    mountConcentrationChart(network, bounds, states.operators, rerender);
    mountHhiChart(network, sources, bounds, states.hhi, rerender);
    mountCoverageChart(network, sources, bounds, states.coverage);
}

// ---- Decay: how stale an older map is for a crawler's nodes ------

// A reversed calendar axis — today on the left, the past on the right —
// so every line climbs as its map ages. Each crawler's line starts at
// the date of its own freshest snapshot (a frozen archive starts months
// back) and runs only over builds at or older than that, so it never
// scores a crawl against maps from its future. A header toggle picks
// what "stale" is measured against:
//
//   - "truth" (default): vs reality. Each build's disagreement with the
//     crawler's own whois ASN. The freshest point is the attribution
//     gap (the map is already that wrong vs live routing), rising into
//     the past — the direct "when do I need a fresher map?" reading.
//     Only crawlers whose anchor snapshot ships whois can be scored, so
//     the rest are greyed out of the legend.
//   - "map": vs that crawler's own freshest map. Its newest map is the
//     yardstick and sits at 0, isolating how much aging alone reshuffles
//     the bucketing. Defined for every crawler.
//
// The axis is laid out in days before today — 0 on the left is "now",
// the same right-edge the other Trends charts anchor to, just mirrored
// into the past — and labelled with the calendar date each offset maps
// back to. The freshest map is a couple of months old, so every line
// starts a short way in from the left edge. The 1Y/3Y/5Y/Max picker
// windows by that span (the "now" terms cancel in domainEnd − cutoff),
// exactly like the calendar charts, so it never shrinks on a pause.
function mountDecayChart(network, sources, bounds, state, rerender) {
    // The shared "now" edge: rangeBounds pins domainEnd to today, so the
    // decay axis mirrors the other charts off the same instant.
    const nowMs = bounds.domainEnd;
    const truthMode = (state.ref ?? "truth") === "truth";
    // Each mode reads its own curve: "map" is anchored on every
    // crawler's newest snapshot; "truth" only exists for crawlers that
    // ship whois, anchored on their newest whois-bearing snapshot.
    const key = truthMode ? "decay_truth" : "decay";

    const usable = sources.filter((s) => network.sources[s][key]?.points?.length);
    // Crawlers with no reality curve (no whois): kept in the legend,
    // greyed with a reason, so they read as "no data here", not a bug.
    const missing = truthMode
        ? sources.filter((s) => !network.sources[s].decay_truth)
        : [];

    const entries = usable.map((source) => ({
        source,
        points: network.sources[source][key].points.map((p) => ({
            // Days before today: today is the left edge, and each build
            // sits its real age in from there.
            ts: (nowMs - toMs(p.build_timestamp)) / MS_PER_DAY,
            value: p.drift_pct,
        })),
    }));

    const ageWindowDays =
        bounds.cutoff === -Infinity
            ? Infinity
            : (bounds.domainEnd - bounds.cutoff) / MS_PER_DAY;
    const timeline = clampTimelineMax(buildUnionTimeline(entries), ageWindowDays);

    const refToggle = ensureToggle(state, () =>
        createModeSwitch({
            options: ["truth", "map"].map((value) => ({
                value,
                label: t(`network.decay.reference.${value}`),
            })),
            value: state.ref ?? "truth",
            onChange: (next) => {
                state.ref = next;
                rerender();
            },
            ariaLabel: t("network.decay.reference.ariaLabel"),
        }),
    );

    mountSeriesChart(document.querySelector("[data-network-decay]"), {
        title: t("network.decay.title"),
        lede: t(truthMode ? "network.decay.ledeTruth" : "network.decay.ledeMap"),
        ariaLabel: t("network.decay.ariaLabel"),
        headerExtra: refToggle,
        timestamps: timeline.timestamps,
        series: legendSeries(usable),
        unavailableSeries: missing.map((s) => ({
            ...sourceSeries(s),
            title: t("network.decay.noWhois"),
        })),
        valueAt: timeline.valueAt,
        yFormat: formatPercentNumber,
        yFloorZero: true,
        ...ageAxisSpec(decayAxisMax(timeline.timestamps, bounds), nowMs),
        tooltipTitleAt: (i) =>
            t("network.decay.tooltipTitle", {
                date: formatDate(new Date(nowMs - timeline.timestamps[i] * MS_PER_DAY)),
                days: Math.round(timeline.timestamps[i]),
            }),
        tooltipRowsAt: (i) =>
            sourceRows(usable, timeline, i, (v) => formatPercentNumber(v)),
        state,
    });
}

// Compact month + year for the reversed-calendar ticks ("Jun 2026"); a
// day-precise label would crowd a multi-year axis, and the tooltip keeps
// the exact build date anyway.
const tickDateFormatter = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    timeZone: "UTC",
});

// Calendar step sizes for the age axis, largest first. The axis is laid
// out in age days but ticks are labelled with the date they map back to,
// so the spacing must land on calendar-nice ages: whole years past two
// years, quarters past a quarter, weeks/months below. The tooltip keeps
// the exact day count and date, so no precision is lost.
const AGE_AXIS_UNITS = [
    { minDays: 2 * 365, days: 365, steps: [1, 2, 5, 10] },
    { minDays: 91, days: 30, steps: [1, 2, 3, 6] },
    { minDays: 0, days: 1, steps: [7, 14, 30, 60, 90] },
];

// The age the x axis spans. A bounded range pins the axis to the full
// window width (365 / 1095 / 1825 days), so it reads "1y"/"3y"/"5y"
// even when a publishing pause leaves the data short of the edge. "max"
// (cutoff −Infinity) spans the real data extent.
function decayAxisMax(ages, bounds) {
    const dataMax = ages.length ? ages[ages.length - 1] : 1;
    if (bounds.cutoff === -Infinity) return Math.max(1, dataMax);
    return (bounds.domainEnd - bounds.cutoff) / MS_PER_DAY;
}

// Reversed-calendar x axis: domain [0, axisMax] in days before today
// (0 = "now" on the left), with ticks on calendar boundaries labelled
// by the date each offset maps back to. ``nowMs`` is the shared right
// edge (today), so an offset of A days reads as nowMs − A.
function ageAxisSpec(axisMax, nowMs) {
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
            label: tickDateFormatter.format(new Date(nowMs - value * MS_PER_DAY)),
        });
    }
    return { linearDomain: true, domainStart: 0, domainEnd: axisMax, xTicks };
}

// ---- AS concentration (HHI) over time ---------------------------

// The headline concentration trend: the same HHI the hero card shows,
// scored against the build in effect at each snapshot. Unlike the
// per-operator breakdown below (KIT only), HHI is a single normalised
// number comparable across crawlers, so this overlays every source —
// two independent crawls tracing the same decline is the credibility
// signal. The y-axis auto-scales (no zero floor): HHI lives in a narrow
// band, so flooring at zero would flatten the trend.
//
// Points are bucketed by calendar day: KIT and Bitnodes snapshots
// matched to the same map land hours apart and would otherwise sit on
// adjacent slots with separate hovers. One slot per day puts both in a
// single tooltip; the few-hour shift is invisible at ~monthly spacing,
// and genuinely different days still stay apart.
//
// A family toggle (All / IPv4 / IPv6) sits in the header: Core treats
// the families as independent dimensions, and the ~80/20 split means the
// combined index is IPv4-dominated, so IPv6 would otherwise be invisible.
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

    const familyToggle = ensureToggle(state, () =>
        createModeSwitch({
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
        }),
    );

    mountSeriesChart(slot, {
        title: t("network.hhi.title"),
        lede: t("network.hhi.lede"),
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
// snapshot's clearnet nodes the build in effect resolves to a real AS.
// A sinking line means kartograf's input data is falling behind the
// network — independent of the HHI distribution above.
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
        lede: t("network.coverage.lede"),
        ariaLabel: t("network.coverage.ariaLabel"),
        timestamps: timeline.timestamps,
        series: legendSeries(sources),
        valueAt: timeline.valueAt,
        yFormat: formatPercentNumber,
        // Coverage is a share of the snapshot's nodes: 100% is a hard
        // ceiling, so the axis must not pad past it.
        yCeil: 100,
        domainStart: bounds.domainStart,
        domainEnd: bounds.domainEnd,
        tooltipTitleAt: (i) => snapshotTitle(timeline, i),
        tooltipRowsAt: (i) => sourceRows(sources, timeline, i, formatPercentNumber),
        state,
    });
}

// ---- Operator concentration over time ---------------------------

// The top-operator breakdown: stacked bars per snapshot, segmented
// into that snapshot's actual top five so the height is the honest
// per-period CR5 (see operators-chart.js). A stack is single-source by
// nature (three overlaid stacks are unreadable), so instead of forcing
// one crawl it carries a header source switch — every crawl scores its
// own top_ases, and the BitMEX roster makes its hosting-heavy vantage
// visible rather than hiding it. ``state.source`` persists the pick
// across range re-mounts; ``rerender`` re-runs the trends on a switch.
function mountConcentrationChart(network, bounds, state, rerender) {
    const parent = document.querySelector("[data-network-concentration]");
    if (!parent) return;
    const sources = SOURCE_ORDER.filter(
        (s) => network.sources[s]?.snapshots?.length,
    );
    if (sources.length === 0) {
        parent.replaceChildren();
        return;
    }
    if (!sources.includes(state.source)) state.source = sources[0];

    // One switch instance, cached on state, so a range re-mount re-uses
    // it (the card keeps its header, the pill keeps its transition).
    const toggle =
        sources.length > 1
            ? ensureToggle(state, () =>
                  createModeSwitch({
                      options: sources.map((s) => ({
                          value: s,
                          label: sourceLabel(s),
                      })),
                      value: state.source,
                      onChange: (next) => {
                          state.source = next;
                          rerender();
                      },
                      ariaLabel: t("network.concentration.sourceSwitchAria"),
                  }),
              )
            : null;
    if (toggle) toggle.setValue(state.source);

    mountOperatorsChart(parent, {
        snapshots: network.sources[state.source].snapshots,
        bounds,
        headerExtra: toggle,
    });
}

// ---- shared helpers ---------------------------------------------

// Series descriptors for the trend charts. Every source uses its plain
// label: KIT and Bitnodes are both ongoing crawls (the Bitnodes line
// stitches the b10c archive to the bitnod.es / BitMEX continuation), so
// neither is marked as a frozen archive.
function legendSeries(sources) {
    return sources.map(sourceSeries);
}

function snapshotTitle(timeline, slot) {
    return formatDate(new Date(timeline.timestamps[slot]));
}

// One row per source, always in the same order. A source with no
// value at this slot shows an em dash instead of dropping its row,
// so the readout's height stays constant while scrubbing.
function sourceRows(sources, timeline, slot, format) {
    return sources.map((source) => {
        const value = timeline.valueAt(source, slot);
        return [sourceLabel(source), value == null ? "\u2014" : format(value)];
    });
}

// drift_pct and coverage arrive as plain percent numbers (3.8 ->
// "3.8%"), unlike format.js formatPercent which expects a 0..1 ratio.
// One decimal keeps movement legible without implying false precision.
function formatPercentNumber(value) {
    return `${value.toFixed(1)}%`;
}

// HHI is a 0..1 index that lives near 0.02; three decimals keep the
// snapshot-to-snapshot movement legible on the axis and in tooltips.
function formatHhi(value) {
    return value.toFixed(3);
}
