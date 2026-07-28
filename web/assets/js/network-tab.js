// Network tab: the "network tap" from the proposal. Scores the
// observed Bitcoin node set (the Bitnodes crawler lineage) against
// the published ASmap history. Reads the optional ``network`` section
// of metrics.json; when absent (public deploy before snapshot data is
// published) the tab is never mounted and app.js hides its nav entry.
//
// Layout, top to bottom: a snapshot hero (up to six cards, paired by
// theme - see overview.js), four range-windowed trend charts (decay
// curve, top-5 operator breakdown, HHI concentration, ASmap coverage),
// then the ASN-attribution agreement as a data-quality stat, then a
// Limitations section (same chrome as Network / Trends) for population
// exclusions (docs/network-exclusions.md). Deliberately no raw unique-AS
// "diversity" chart: that count is confounded by how many nodes each
// crawler reaches, so two raw-count lines invite a false comparison.
//
// The archive-to-live handoff remains visible as an annotated marker,
// while every chart follows the one continuous crawler lineage.
//
// The Trends section's 1Y/3Y/5Y/Max range picker (mirroring the Maps
// History range) windows the trend charts' x-axis; the hero and
// data-quality stat stay on the latest data. The charts live in
// components/network/trend-charts.js and the data-quality card in
// components/network/cross-check.js; this module wires them to the
// range picker.

import { formatDate } from "./format.js";
import * as overview from "./components/network/overview.js";
import { mountCrossCheckStat } from "./components/network/cross-check.js";
import { mountLimitationsNote } from "./components/network/limitations-note.js";
import {
    defaultDecayReference,
    resolveDecayReference,
} from "./components/network/decay-reference.js";
import {
    SOURCE_ORDER,
    latestLineageLabel,
    toMs,
} from "./components/network/series-data.js";
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
    const overviewSlot = document.querySelector("[data-network-overview]");

    // The lede is static (what this tab does + the clearnet scope it
    // measures), so it is set once. The per-crawl "as of" date is not
    // in the lede; it rides on the card row via the snapshot caption so
    // it tracks the source switch without rewriting the paragraph.
    const ledeSlot = document.querySelector("[data-network-lede]");
    if (ledeSlot) {
        ledeSlot.textContent = `${t("network.overview.sectionLede")} ${t(
            "network.overview.clearnetNote",
        )}`;
    }

    const data = network.sources[primary];
    const latest = data.snapshots[data.snapshots.length - 1];
    overview.mount(overviewSlot, {
        snapshot: latest,
        decay: data.decay,
        latestUpdate: data.latest_update ?? null,
        asOf: t("network.overview.snapshotMeta", {
            source: latestLineageLabel(network, primary),
            date: formatDate(latest.label),
            build: formatDate(new Date(toMs(latest.build.timestamp))),
        }),
    });

    // A deep link can pin the Trends range plus the decay reference and
    // HHI family so a shared finding opens on the same view.
    const hash = readHashState(TAB);
    const requestedRange = hash.get("range");
    const requestedRef = hash.get("ref");
    const requestedFamily = hash.get("family");
    const defaultRef = defaultDecayReference(network, presentSources);

    // Per-chart toggle state hoisted here so a range re-mount keeps
    // hidden series - and, for decay / HHI, the active reference or family.
    const states = {
        decay: {
            hidden: new Set(),
            ref: resolveDecayReference(network, presentSources, requestedRef),
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
        // Single re-render path: the range picker and in-chart axis /
        // family toggles all route through here, so writing the hash
        // captures every Trends view change. Only non-default
        // selections are emitted, keeping the default view on a bare
        // "#network".
        writeHashState(TAB, {
            range: range !== DEFAULT_RANGE ? range : null,
            ref: states.decay.ref !== defaultRef ? states.decay.ref : null,
            family: states.hhi.family !== "all" ? states.hhi.family : null,
        });
        const bounds = rangeBounds(range, allTimestamps);
        mountTrendCharts(
            network,
            presentSources,
            bounds,
            states,
            renderTrends,
            range,
        );
    };

    // Data-quality stat is range-independent; Limitations is its own
    // section under Trends (same chrome as Network → Trends).
    mountCrossCheckStat(network, presentSources, primary);
    mountLimitationsNote();

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
