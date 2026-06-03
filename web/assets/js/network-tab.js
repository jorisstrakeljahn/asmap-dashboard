// Network tab: the "network tap" from the proposal. Scores the
// observed Bitcoin node set (KIT monitor crawls, Bitnodes snapshots)
// against the published ASmap history. Reads the optional ``network``
// section of metrics.json; when that key is absent (the public deploy
// before the snapshot data is published) the tab is never mounted and
// app.js hides its nav entry.
//
// Layout, top to bottom, follows the proposal's "reads as one answer"
// order: a 2x2 snapshot hero, then two trend charts — the decay curve
// (the update-cadence question) and the top-5 operator breakdown (the
// decentralisation question) — and finally the ASN-attribution
// agreement as a single data-quality stat that keeps the headline KPI
// but reveals the exact per-snapshot counts (both crawlers) behind a
// disclosure, so the figure is checkable rather than asserted. Earlier
// iterations carried a bucketing time series (near-constant, moved to
// the hero) and a raw unique-AS-count "diversity" chart (dropped: the
// count is confounded by how many nodes each crawler reaches, so two
// raw-count lines invite a false comparison).
//
// The decay chart overlays KIT and Bitnodes as toggleable lines because
// it plots a normalised drift share, comparable across crawlers of
// different size. KIT is the ongoing crawl; the Bitnodes snapshots are a
// one-time historical archive (b10c) that freezes once it ends, kept as
// a frozen second line because two independent crawlers telling the same
// story is the dashboard's strongest credibility signal, but labelled
// "archive" in the legend so no reader mistakes the frozen line for a
// live feed. The operator breakdown is
// KIT only — five per-operator lines for a frozen second crawler would
// clutter without adding a comparison the decay chart doesn't make.
//
// The Trends section carries a 1Y/3Y/5Y/Max range picker, mirroring
// the Maps tab's History range. It windows the x-axis of the trend
// charts; the hero and the data-quality stat stay on the latest data.

import { formatDate, formatNumber } from "./format.js";
import { nameFor } from "./asn-names.js";
import * as overview from "./components/network/overview.js";
import { mountSeriesChart } from "./components/network/series-chart.js";
import {
    SOURCE_ORDER,
    buildUnionTimeline,
    sourceLabel,
    sourceSeries,
    toMs,
} from "./components/network/series-data.js";
import { createInfoTooltip } from "./components/info-tooltip.js";
import { createModeSwitch } from "./components/mode-switch.js";
import { t } from "./utils/i18n.js";

const SECONDS_PER_DAY = 86400;
const MS_PER_DAY = 86_400_000;

// Mirror the Maps tab's History range picker. Bounded ranges pin the
// x-axis to [now - N days, now]; "max" spans the full data extent.
const RANGE_VALUES = ["1y", "3y", "5y", "max"];
const RANGE_DAYS = { "1y": 365, "3y": 365 * 3, "5y": 365 * 5 };
const DEFAULT_RANGE = "max";

// Mount the tab. Returns true when a network section was present and
// rendered, false otherwise, so the caller can hide the nav entry.
export function mount(payload) {
    const network = payload?.network;
    if (!network || !network.sources) return false;

    const presentSources = SOURCE_ORDER.filter(
        (s) => network.sources[s]?.snapshots?.length,
    );
    if (presentSources.length === 0) return false;

    const primary = presentSources[0];
    const primaryData = network.sources[primary];
    const latest = primaryData.snapshots[primaryData.snapshots.length - 1];

    overview.mount(document.querySelector("[data-network-overview]"), {
        snapshot: latest,
        decay: primaryData.decay,
        source: primary,
    });

    // One source line for the whole hero: all four cards read the
    // primary crawl's latest snapshot, and the cards no longer repeat
    // it individually. Names the comparison source when more than one
    // crawler is present so the reader knows the Trends overlay them.
    const sourceSlot = document.querySelector("[data-network-source]");
    if (sourceSlot) {
        const base = t("network.overview.sourceMeta", {
            source: sourceLabel(primary),
            date: formatDate(latest.label),
        });
        const others = presentSources.filter((s) => s !== primary);
        sourceSlot.textContent = others.length
            ? `${base} ${t("network.overview.sourceCompare", {
                  sources: others.map(sourceLabel).join(", "),
              })}`
            : base;
    }

    // Per-chart toggle state is hoisted here so a range re-mount keeps
    // whatever series the reader has hidden.
    const states = {
        decay: { hidden: new Set() },
        hhi: { hidden: new Set() },
        concentration: { hidden: new Set() },
    };
    const allTimestamps = collectTimestamps(network, presentSources);

    let range = DEFAULT_RANGE;
    const renderTrends = () => {
        const bounds = rangeBounds(range, allTimestamps);
        mountDecayChart(network, presentSources, bounds, states.decay);
        mountConcentrationChart(network, bounds, states.concentration);
        mountHhiChart(network, presentSources, bounds, states.hhi);
    };

    // The data-quality stat summarises the whole series, so it is not
    // range-dependent and renders once outside renderTrends. It scores
    // every source that ships an ASN, not just the primary, so the
    // disclosure table can cross-validate KIT against Bitnodes.
    mountCrossCheckStat(network, presentSources, primary);

    const rangeSlot = document.querySelector("[data-network-range]");
    if (rangeSlot) {
        const picker = createModeSwitch({
            options: RANGE_VALUES.map((value) => ({
                value,
                label: t(`history.range.${value}`),
            })),
            value: range,
            onChange: (next) => {
                range = next;
                renderTrends();
            },
            ariaLabel: t("history.range.ariaLabel"),
        });
        rangeSlot.replaceChildren(picker);
    }

    renderTrends();
    return true;
}

// ---- Decay: drift of today's node set vs each build's age -------

function mountDecayChart(network, sources, bounds, state) {
    const referenceTs = network.reference_timestamp;
    const entries = sources.map((source) => ({
        source,
        points: network.sources[source].decay.points.map((p) => ({
            ts: toMs(p.build_timestamp),
            value: p.drift_pct,
        })),
    }));
    const timeline = clampTimeline(buildUnionTimeline(entries), bounds.cutoff);

    mountSeriesChart(document.querySelector("[data-network-decay]"), {
        title: t("network.decay.title"),
        info: t("network.decay.info"),
        infoAria: t("network.decay.infoAria"),
        ariaLabel: t("network.decay.ariaLabel"),
        timestamps: timeline.timestamps,
        series: legendSeries(sources),
        valueAt: timeline.valueAt,
        yFormat: formatPercentNumber,
        yFloorZero: true,
        domainStart: bounds.domainStart,
        domainEnd: bounds.domainEnd,
        tooltipTitleAt: (i) =>
            t("network.decay.tooltipTitle", {
                date: formatDate(new Date(timeline.timestamps[i])),
                days: ageDays(referenceTs, timeline.timestamps[i]),
            }),
        tooltipRowsAt: (i) =>
            sourceRows(sources, timeline, i, (v) => formatPercentNumber(v)),
        state,
    });
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
function mountHhiChart(network, sources, bounds, state) {
    const slot = document.querySelector("[data-network-hhi]");
    if (!slot) return;
    const entries = sources.map((source) => ({
        source,
        points: network.sources[source].snapshots.map((sn) => ({
            ts: toMs(sn.timestamp),
            value: sn.hhi,
        })),
    }));
    const timeline = clampTimeline(dayUnionTimeline(entries), bounds.cutoff);

    mountSeriesChart(slot, {
        title: t("network.hhi.title"),
        info: t("network.hhi.info"),
        infoAria: t("network.hhi.infoAria"),
        ariaLabel: t("network.hhi.ariaLabel"),
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

// ---- Operator concentration over time ---------------------------

// How many top operators the breakdown view tracks as individual lines.
// Five is the conventional concentration cut (CR5) and keeps the chart
// legible; the combined line sums exactly these five.
const OPERATOR_LIMIT = 5;

// Per-operator line styling, drawn from the shared categorical palette
// (tokens.css --color-series-1..5) so the operators read as distinct
// categories rather than a ranking. Indexed by rank within the period.
const OPERATOR_STYLES = [1, 2, 3, 4, 5].map((n) => ({
    lineClass: `chart__line--op${n}`,
    dotClass: `chart__dot--op${n}`,
    swatchClass: `chart-legend__swatch--op${n}`,
}));

// The concentration chart is the top-operator breakdown (KIT only): the
// OPERATOR_LIMIT operators with the highest share over the whole period
// as fixed named lines, plus a dashed combined (CR5) line. It is the
// churn/diversity view — whether the combined top share is shrinking and
// whether the top tier reshuffles. KIT only because it is the live crawl;
// the KIT/Bitnodes cross-check lives in the decay chart above.
//
// Operator breakdown needs KIT, so without it there is nothing to plot
// here and the chart slot stays empty (decay + cross-check still render).
function mountConcentrationChart(network, bounds, state) {
    const parent = document.querySelector("[data-network-concentration]");
    if (!parent) return;
    if (!network.sources.kit?.snapshots?.length) {
        parent.replaceChildren();
        return;
    }
    renderOperatorsView(parent, network, bounds, state);
}

// Top-operator breakdown (KIT only): the OPERATOR_LIMIT operators with
// the highest share summed across the whole period, each as its own
// fixed line, plus a dashed combined line that sums exactly those five.
// An operator absent from a given snapshot's top list reports null, so
// its line simply does not extend into periods where it was small.
function renderOperatorsView(slot, network, bounds, state) {
    const snapshots = network.sources.kit.snapshots;
    const operators = topOperators(snapshots, OPERATOR_LIMIT);

    // ts -> (asn -> share) for O(1) per-slot lookup.
    const shareByTs = new Map();
    for (const sn of snapshots) {
        const shares = new Map();
        for (const entry of sn.top_ases ?? []) shares.set(entry.asn, entry.share);
        shareByTs.set(toMs(sn.timestamp), shares);
    }
    const timestamps = snapshots.map((sn) => toMs(sn.timestamp)).sort((a, b) => a - b);

    const valueAt = (key, slot) => {
        const shares = shareByTs.get(timestamps[slot]);
        if (!shares) return null;
        if (key === "combined") {
            let sum = 0;
            let any = false;
            for (const asn of operators) {
                const share = shares.get(asn);
                if (share != null) {
                    sum += share;
                    any = true;
                }
            }
            return any ? sum * 100 : null;
        }
        const share = shares.get(Number(key.slice(3)));
        return share == null ? null : share * 100;
    };
    const timeline = clampTimeline({ timestamps, valueAt }, bounds.cutoff);

    const operatorSeries = operators.map((asn, idx) => ({
        key: `as-${asn}`,
        label: operatorLabel(asn),
        ...OPERATOR_STYLES[idx % OPERATOR_STYLES.length],
    }));
    // Combined (CR5) line leads the list so it reads first in the
    // legend. It reuses the drift chart's neutral dashed "aggregate"
    // styling so the eye reads it as a sum, not a sixth operator.
    const series = [
        {
            key: "combined",
            label: t("network.concentration.combinedLabel", { count: operators.length }),
            lineClass: "chart__line--total",
            dotClass: "chart__dot--total",
            swatchClass: "chart-legend__swatch--total",
        },
        ...operatorSeries,
    ];

    mountSeriesChart(slot, {
        title: t("network.concentration.operatorsTitle"),
        info: t("network.concentration.operatorsInfo"),
        infoAria: t("network.concentration.operatorsInfoAria"),
        ariaLabel: t("network.concentration.operatorsAria"),
        timestamps: timeline.timestamps,
        series,
        valueAt: timeline.valueAt,
        yFormat: formatPercentNumber,
        yFloorZero: true,
        domainStart: bounds.domainStart,
        domainEnd: bounds.domainEnd,
        tooltipTitleAt: (i) => snapshotTitle(timeline, i),
        tooltipRowsAt: (i) => operatorRows(series, timeline, i),
        state,
    });
}

// The operators with the highest share summed over every snapshot.
// Summing per-snapshot shares (rather than raw node counts) weights
// each snapshot equally, so a single large crawl can't crown an
// operator that was only briefly present.
function topOperators(snapshots, limit) {
    const totals = new Map();
    for (const sn of snapshots) {
        for (const entry of sn.top_ases ?? []) {
            totals.set(entry.asn, (totals.get(entry.asn) ?? 0) + entry.share);
        }
    }
    return [...totals.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([asn]) => asn);
}

// Legend/tooltip label for an operator line: the operator name when
// known, falling back to the bare AS number. The name alone (not
// "AS123 (Name)") keeps five entries readable on one legend row.
function operatorLabel(asn) {
    return nameFor(asn) ?? `AS${asn}`;
}

// One tooltip row per operator (and the combined line) that has a value
// at this slot.
function operatorRows(series, timeline, slot) {
    const rows = [];
    for (const entry of series) {
        const value = timeline.valueAt(entry.key, slot);
        if (value == null) continue;
        rows.push([entry.label, formatPercentNumber(value)]);
    }
    if (rows.length === 0) {
        return [[t("network.noSnapshot"), "\u2014"]];
    }
    return rows;
}

// ---- ASN attribution agreement (data-quality stat) --------------

// A single KPI plus an explanatory sentence rather than a time series:
// the agreement is a near-constant ~93%, so a flat two-line chart added
// no signal and its Bitnodes gap read as a bug. The headline reads off
// the primary crawl (KIT annotates every node with an ASN), but a
// disclosure exposes the exact per-snapshot counts for every scored
// source, so the figure is checkable rather than asserted.
function mountCrossCheckStat(network, sources, primary) {
    const slot = document.querySelector("[data-network-crosscheck]");
    if (!slot) return;

    // Every scored snapshot across all sources, newest first, for the
    // disclosure table and the agreement band.
    const rows = [];
    for (const source of sources) {
        for (const sn of network.sources[source].snapshots) {
            if (!sn.cross_check) continue;
            rows.push({ source, label: sn.label, ts: toMs(sn.timestamp), cc: sn.cross_check });
        }
    }
    if (rows.length === 0) {
        slot.replaceChildren();
        return;
    }
    rows.sort((a, b) => b.ts - a.ts);

    const primaryRows = rows.filter((r) => r.source === primary);
    const latest = primaryRows[0] ?? rows[0];
    const values = rows.map((r) => r.cc.agreement_pct);
    const pct = `${Math.round(latest.cc.agreement_pct)}%`;

    const card = document.createElement("article");
    card.className = "card network-quality";

    const info = createInfoTooltip({
        body: t("network.crosscheck.info"),
        ariaLabel: t("network.crosscheck.infoAria"),
    });
    info.classList.add("info-tooltip--card-corner");
    card.append(info);

    const label = document.createElement("span");
    label.className = "card__label uppercase-label";
    label.textContent = t("network.crosscheck.label").toUpperCase();

    const metric = document.createElement("p");
    metric.className = "card__metric";
    metric.textContent = t("network.crosscheck.metric", { pct });

    const note = document.createElement("p");
    note.className = "card__delta network-quality__note";
    note.textContent = t("network.crosscheck.note", {
        source: sourceLabel(primary),
        pct,
        date: formatDate(latest.label),
        min: `${Math.round(Math.min(...values))}%`,
        max: `${Math.round(Math.max(...values))}%`,
    });

    card.append(label, metric, note, crossCheckTable(rows));
    slot.replaceChildren(card);
}

// Disclosure ("switch button") holding the raw per-snapshot counts the
// headline is derived from: date, source, compared, agree, agreement %.
// A native <details> keeps it keyboard-accessible and closed by default
// so the card stays compact until the reader wants to verify.
function crossCheckTable(rows) {
    const details = document.createElement("details");
    details.className = "network-quality__details";

    const summary = document.createElement("summary");
    summary.className = "network-quality__summary";
    summary.textContent = t("network.crosscheck.tableToggle");
    details.append(summary);

    const wrap = document.createElement("div");
    wrap.className = "network-quality__table-wrap";

    const table = document.createElement("table");
    table.className = "network-quality__table";

    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const key of ["colSnapshot", "colSource", "colCompared", "colAgree", "colAgreement"]) {
        const th = document.createElement("th");
        th.textContent = t(`network.crosscheck.${key}`);
        if (key !== "colSnapshot" && key !== "colSource") th.classList.add("is-num");
        headRow.append(th);
    }
    head.append(headRow);

    const body = document.createElement("tbody");
    for (const row of rows) {
        const tr = document.createElement("tr");
        tr.append(
            cell(formatDate(row.label)),
            cell(sourceLabel(row.source)),
            cell(formatNumber(row.cc.compared), true),
            cell(formatNumber(row.cc.agree), true),
            cell(`${row.cc.agreement_pct.toFixed(1)}%`, true),
        );
        body.append(tr);
    }

    table.append(head, body);
    wrap.append(table);
    details.append(wrap);
    return details;
}

function cell(text, numeric = false) {
    const td = document.createElement("td");
    td.textContent = text;
    if (numeric) td.classList.add("is-num");
    return td;
}

// ---- range helpers ----------------------------------------------

// Every timestamp the trends can plot (snapshot times + decay build
// times), used to anchor the "max" domain to the real data extent.
function collectTimestamps(network, sources) {
    const out = [];
    for (const source of sources) {
        const data = network.sources[source];
        for (const sn of data.snapshots) out.push(toMs(sn.timestamp));
        for (const p of data.decay.points) out.push(toMs(p.build_timestamp));
    }
    return out;
}

// Resolve the cutoff (drop points older than this) plus the x-axis
// domain the charts should span. Mirrors utils/history-range.js but
// works on plain ms timestamps rather than the maps array.
function rangeBounds(range, timestamps) {
    const now = Date.now();
    if (range === "max" || !RANGE_DAYS[range]) {
        const first = timestamps.length ? Math.min(...timestamps) : now;
        const last = timestamps.length ? Math.max(...timestamps) : now;
        return { cutoff: -Infinity, domainStart: first, domainEnd: Math.max(now, last) };
    }
    const cutoff = now - RANGE_DAYS[range] * MS_PER_DAY;
    return { cutoff, domainStart: cutoff, domainEnd: now };
}

// Drop the slots before ``cutoff`` while keeping valueAt addressable
// by remapping each surviving slot back to its original index.
function clampTimeline(timeline, cutoff) {
    if (cutoff === -Infinity) return timeline;
    const keep = [];
    for (let i = 0; i < timeline.timestamps.length; i++) {
        if (timeline.timestamps[i] >= cutoff) keep.push(i);
    }
    return {
        timestamps: keep.map((i) => timeline.timestamps[i]),
        valueAt: (source, slot) => timeline.valueAt(source, keep[slot]),
    };
}

// Like buildUnionTimeline, but keys slots by calendar day so points
// from different crawlers that fall on the same day share one slot (and
// therefore one hover) instead of landing on adjacent timestamps. The
// representative timestamp for a day is the earliest point in it, so the
// x-position and tooltip date stay real rather than snapping to midnight.
function dayUnionTimeline(entries) {
    const byDay = new Map();
    for (const entry of entries) {
        for (const point of entry.points) {
            const day = Math.floor(point.ts / MS_PER_DAY);
            let bucket = byDay.get(day);
            if (!bucket) {
                bucket = { ts: point.ts, values: new Map() };
                byDay.set(day, bucket);
            }
            if (point.ts < bucket.ts) bucket.ts = point.ts;
            if (point.value != null) bucket.values.set(entry.source, point.value);
        }
    }
    const days = [...byDay.keys()].sort((a, b) => a - b);
    return {
        timestamps: days.map((d) => byDay.get(d).ts),
        valueAt: (source, slot) => {
            const value = byDay.get(days[slot])?.values.get(source);
            return value == null ? null : value;
        },
    };
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
