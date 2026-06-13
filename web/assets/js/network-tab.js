// Network tab: the "network tap" from the proposal. Scores the
// observed Bitcoin node set (KIT monitor crawls, Bitnodes snapshots)
// against the published ASmap history. Reads the optional ``network``
// section of metrics.json; when that key is absent (the public deploy
// before the snapshot data is published) the tab is never mounted and
// app.js hides its nav entry.
//
// Layout, top to bottom, follows the proposal's "reads as one answer"
// order: a snapshot hero of up to six cards (two per row, paired by
// theme — see overview.js), then four range-windowed trend charts —
// the decay curve (the update-cadence question), the top-5 operator
// breakdown (the decentralisation question), the HHI concentration
// trend, and the ASmap coverage trend — and finally the ASN-attribution
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
// KIT only — a per-operator breakdown for a frozen second crawler would
// clutter without adding a comparison the decay chart doesn't make.
//
// The Trends section carries a 1Y/3Y/5Y/Max range picker, mirroring
// the Maps tab's History range. It windows the x-axis of the trend
// charts; the hero and the data-quality stat stay on the latest data.
// The trend charts themselves live in components/network/trend-charts.js
// and the data-quality card in components/network/cross-check.js; this
// module is the orchestration that wires them to the range picker.

import { formatDate } from "./format.js";
import * as overview from "./components/network/overview.js";
import { mountCrossCheckStat } from "./components/network/cross-check.js";
import { SOURCE_ORDER, sourceLabel } from "./components/network/series-data.js";
import { collectTimestamps } from "./components/network/timelines.js";
import { mountTrendCharts } from "./components/network/trend-charts.js";
import { createModeSwitch } from "./components/mode-switch.js";
import { readHashState, writeHashState } from "./utils/hash-state.js";
import {
    DEFAULT_HISTORY_RANGE as DEFAULT_RANGE,
    HISTORY_RANGE_VALUES as RANGE_VALUES,
    rangeBounds,
} from "./utils/history-range.js";
import { t } from "./utils/i18n.js";

// Network is not the default tab, so it only writes its state once the
// hash already carries the "#network" token (no empty-hash stamping).
const TAB = "network";
const DECAY_AXES = ["age", "date"];
const HHI_FAMILIES = ["all", "ipv4", "ipv6"];

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
        latestUpdate: network.latest_update,
    });

    // One source line for the whole hero: all four cards read the
    // primary crawl's latest snapshot, so the individual cards don't
    // repeat it. Names the comparison source when more than one
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

    // A deep link can pin the Trends range plus the decay axis and HHI
    // family so a shared finding opens on the same view.
    const hash = readHashState(TAB);
    const requestedRange = hash.get("range");
    const requestedAxis = hash.get("axis");
    const requestedFamily = hash.get("family");

    // Per-chart toggle state is hoisted here so a range re-mount keeps
    // whatever series the reader has hidden — and, for the decay /
    // HHI charts, which axis or family view is active. The operator
    // breakdown carries no legend (its per-period cast changes), so
    // it has no entry here.
    const states = {
        decay: {
            hidden: new Set(),
            axis: DECAY_AXES.includes(requestedAxis) ? requestedAxis : "age",
        },
        hhi: {
            hidden: new Set(),
            family: HHI_FAMILIES.includes(requestedFamily)
                ? requestedFamily
                : "all",
        },
        coverage: { hidden: new Set() },
    };
    const allTimestamps = collectTimestamps(network, presentSources);

    let range = RANGE_VALUES.includes(requestedRange)
        ? requestedRange
        : DEFAULT_RANGE;
    const renderTrends = () => {
        // renderTrends is the single re-render path: the range picker and
        // the in-chart axis / family toggles all route through it, so
        // writing the hash here captures every Trends view change. Only
        // non-default selections are emitted, so the default Trends view
        // keeps a bare "#network" with nothing extra to share.
        writeHashState(TAB, {
            range: range !== DEFAULT_RANGE ? range : null,
            axis: states.decay.axis !== "age" ? states.decay.axis : null,
            family: states.hhi.family !== "all" ? states.hhi.family : null,
        });
        const bounds = rangeBounds(range, allTimestamps);
        mountTrendCharts(network, presentSources, bounds, states, renderTrends);
    };

    // The data-quality stat summarises the whole series, so it is not
    // range-dependent and renders once outside renderTrends.
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
