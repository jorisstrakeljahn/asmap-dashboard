// Network tab: the "network tap" from the proposal. Scores the
// observed Bitcoin node set (KIT crawls, Bitnodes snapshots) against
// the published ASmap history. Reads the optional ``network`` section
// of metrics.json; when absent (public deploy before snapshot data is
// published) the tab is never mounted and app.js hides its nav entry.
//
// Layout, top to bottom: a snapshot hero (up to six cards, paired by
// theme — see overview.js), four range-windowed trend charts (decay
// curve, top-5 operator breakdown, HHI concentration, ASmap coverage),
// then the ASN-attribution agreement as a data-quality stat that keeps
// the headline KPI but exposes the per-snapshot counts behind a
// disclosure so the figure is checkable. Deliberately no raw
// unique-AS "diversity" chart: that count is confounded by how many
// nodes each crawler reaches, so two raw-count lines invite a false
// comparison.
//
// The decay chart overlays KIT and Bitnodes as toggleable lines: it
// plots a normalised drift share, comparable across crawlers of
// different size. KIT is the ongoing crawl; the Bitnodes snapshots are
// a one-time b10c archive, frozen once it ends but kept as a second
// line (two independent crawlers agreeing is the strongest credibility
// signal) and labelled "archive" so no reader mistakes it for a live
// feed. The operator breakdown is KIT-only — a breakdown for a frozen
// crawler would clutter without adding a comparison.
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

    // The hero is introduced by one paragraph: the static section lede
    // (what this tab does) plus the crawl provenance (which snapshot the
    // cards read, and any archived comparison source). They read as one
    // thought, so they share a single sentence rather than splitting the
    // provenance into a separate meta line below the heading.
    const ledeSlot = document.querySelector("[data-network-lede]");
    if (ledeSlot) {
        const provenance = t("network.overview.sourceMeta", {
            source: sourceLabel(primary),
            date: formatDate(latest.label),
        });
        const others = presentSources.filter((s) => s !== primary);
        const source = others.length
            ? `${provenance} ${t("network.overview.sourceCompare", {
                  sources: others.map(sourceLabel).join(", "),
              })}`
            : provenance;
        ledeSlot.textContent = `${t("network.overview.sectionLede")} ${source}`;
    }

    // A deep link can pin the Trends range plus the decay axis and HHI
    // family so a shared finding opens on the same view.
    const hash = readHashState(TAB);
    const requestedRange = hash.get("range");
    const requestedAxis = hash.get("axis");
    const requestedFamily = hash.get("family");

    // Per-chart toggle state hoisted here so a range re-mount keeps
    // hidden series — and, for decay / HHI, the active axis or family.
    // The operator breakdown has no legend (its per-period cast
    // changes), so no entry here.
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
        // Single re-render path: the range picker and in-chart axis /
        // family toggles all route through here, so writing the hash
        // captures every Trends view change. Only non-default
        // selections are emitted, keeping the default view on a bare
        // "#network".
        writeHashState(TAB, {
            range: range !== DEFAULT_RANGE ? range : null,
            axis: states.decay.axis !== "age" ? states.decay.axis : null,
            family: states.hhi.family !== "all" ? states.hhi.family : null,
        });
        const bounds = rangeBounds(range, allTimestamps);
        mountTrendCharts(network, presentSources, bounds, states, renderTrends);
    };

    // The data-quality stat summarises the whole series, so it is
    // range-independent and renders once outside renderTrends.
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
