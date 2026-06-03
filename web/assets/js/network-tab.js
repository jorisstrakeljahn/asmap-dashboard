// Network tab: the "network tap" from the proposal. Scores the
// observed Bitcoin node set (KIT monitor crawls, Bitnodes snapshots)
// against the published ASmap history. Reads the optional ``network``
// section of metrics.json; when that key is absent (the public deploy
// before the snapshot data is published) the tab is never mounted and
// app.js hides its nav entry.
//
// Layout, top to bottom, follows the proposal's "reads as one answer"
// order: a 2x2 snapshot hero, then two trend charts — the decay curve
// (the update-cadence question) and the largest-operator share (the
// decentralisation question) — and finally the ASN-attribution
// agreement as a single data-quality stat that keeps the headline KPI
// but reveals the exact per-snapshot counts (both crawlers) behind a
// disclosure, so the figure is checkable rather than asserted. Earlier
// iterations carried
// a bucketing time series (near-constant, moved to the hero) and a raw
// unique-AS-count "diversity" chart (dropped: the count is confounded
// by how many nodes each crawler reaches, so two raw-count lines invite
// a false comparison). The two surviving charts overlay KIT and
// Bitnodes as toggleable lines because they plot normalised shares,
// which are comparable across crawlers of different size.
//
// KIT is the ongoing crawl; the Bitnodes snapshots are a one-time
// historical archive (b10c) that freezes once it ends. They are kept
// as a frozen second line because two independent crawlers telling the
// same story is the dashboard's strongest credibility signal, but they
// are labelled "archive" in the legend and a Trends provenance note so
// no reader mistakes the frozen line for a live feed.
//
// The Trends section carries a 1Y/3Y/5Y/Max range picker, mirroring
// the Maps tab's History range. It windows the x-axis of the trend
// charts; the hero and the data-quality stat stay on the latest data.

import { formatDate, formatNumber } from "./format.js";
import { labelFor } from "./asn-names.js";
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
        concentration: { hidden: new Set() },
    };
    const allTimestamps = collectTimestamps(network, presentSources);

    let range = DEFAULT_RANGE;
    const renderTrends = () => {
        const bounds = rangeBounds(range, allTimestamps);
        mountDecayChart(network, presentSources, bounds, states.decay);
        mountConcentrationChart(network, presentSources, bounds, states.concentration);
    };

    // Provenance note for the Trends: KIT is the live crawl, Bitnodes a
    // frozen archive. Filled dynamically so the cutoff date tracks the
    // data rather than a hard-coded string.
    mountTrendsNote(network, presentSources, primary);

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

// ---- Largest-operator node share over time ----------------------

// Plots the single most-present AS's node share rather than HHI: a
// percentage reads far more intuitively than "HHI 0.02", and it is the
// most legible driver of the concentration story. The #1 operator's
// identity can change between snapshots, so this tracks whichever AS is
// largest at each point — a valid concentration measure regardless.
function mountConcentrationChart(network, sources, bounds, state) {
    const timeline = clampTimeline(
        snapshotTimeline(network, sources, topShare),
        bounds.cutoff,
    );
    // Per-source lookup of the largest AS at each snapshot, so the
    // tooltip can name who the share belongs to. The #1 operator can
    // change between snapshots, and showing it for both crawlers makes
    // it obvious whether they agree on who dominates.
    const topBySource = topAsLookup(network, sources);
    mountSeriesChart(document.querySelector("[data-network-concentration]"), {
        title: t("network.concentration.title"),
        info: t("network.concentration.info"),
        infoAria: t("network.concentration.infoAria"),
        ariaLabel: t("network.concentration.ariaLabel"),
        timestamps: timeline.timestamps,
        series: legendSeries(sources),
        valueAt: timeline.valueAt,
        yFormat: formatPercentNumber,
        yFloorZero: true,
        domainStart: bounds.domainStart,
        domainEnd: bounds.domainEnd,
        tooltipTitleAt: (i) => snapshotTitle(timeline, i),
        tooltipRowsAt: (i) => concentrationRows(sources, timeline, topBySource, i),
        state,
    });
}

// Map source -> (snapshot ms -> largest AS object), keyed on the same
// timestamps the concentration timeline uses.
function topAsLookup(network, sources) {
    const bySource = new Map();
    for (const source of sources) {
        const byTs = new Map();
        for (const sn of network.sources[source].snapshots) {
            const top = sn.top_ases?.[0];
            if (top) byTs.set(toMs(sn.timestamp), top);
        }
        bySource.set(source, byTs);
    }
    return bySource;
}

// Tooltip rows for the concentration chart: each source's share with the
// operator that holds it folded into the (wrappable) label column, e.g.
// "KIT, AS24940 (Hetzner Online GmbH)" -> "8.7%". The percent stays the
// atomic value so it never wraps; the long operator name rides the label.
function concentrationRows(sources, timeline, topBySource, slot) {
    const ts = timeline.timestamps[slot];
    const rows = [];
    for (const source of sources) {
        const share = timeline.valueAt(source, slot);
        if (share == null) continue;
        const top = topBySource.get(source)?.get(ts);
        const who = top ? labelFor(top.asn) : "";
        const label = who ? `${sourceLabel(source)}, ${who}` : sourceLabel(source);
        rows.push([label, formatPercentNumber(share)]);
    }
    if (rows.length === 0) {
        return [[t("network.noSnapshot"), "\u2014"]];
    }
    return rows;
}

// Largest single AS's node share as a plain percent number (8.7 ->
// "8.7%"). Null when a snapshot carries no AS breakdown.
function topShare(snapshot) {
    const top = snapshot.top_ases?.[0];
    return top ? top.share * 100 : null;
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

// Trends provenance note: names the live crawl and flags Bitnodes as a
// frozen archive with its last snapshot date, so the frozen second line
// is never mistaken for a live feed.
function mountTrendsNote(network, sources, primary) {
    const slot = document.querySelector("[data-network-trends-note]");
    if (!slot) return;
    const archived = sources.filter((s) => s !== primary);
    if (archived.length === 0) {
        slot.textContent = t("network.charts.sourceNoteSingle", {
            source: sourceLabel(primary),
        });
        return;
    }
    const lastTs = Math.max(
        ...archived.flatMap((s) =>
            network.sources[s].snapshots.map((sn) => toMs(sn.timestamp)),
        ),
    );
    slot.textContent = t("network.charts.sourceNote", {
        source: sourceLabel(primary),
        archive: archived.map(sourceLabel).join(", "),
        date: formatDate(new Date(lastTs)),
    });
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

// Union timeline keyed on snapshot timestamps, one series per source.
function snapshotTimeline(network, sources, accessor) {
    const entries = sources.map((source) => ({
        source,
        points: network.sources[source].snapshots.map((sn) => ({
            ts: toMs(sn.timestamp),
            value: accessor(sn),
        })),
    }));
    return buildUnionTimeline(entries);
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
