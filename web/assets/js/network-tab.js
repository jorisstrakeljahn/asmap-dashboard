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
// The decay chart overlays KIT and the two Bitnodes crawls as
// toggleable lines: it plots a normalised drift share, comparable
// across crawlers of different size. The Bitnodes feed split when
// bitnodes.io shut down — "bitnodes" is the frozen b10c archive,
// "bitmex" is the bitnod.es / BitMEX continuation — and they stay
// separate lines because BitMEX's vantage reaches a different
// population (so a spliced line would fake a concentration step at the
// handover). Several independent crawlers agreeing is the strongest
// credibility signal. The operator breakdown is KIT-only: KIT carries
// full whois on every node, so its per-AS roster is the trustworthy
// one, and extra breakdowns would clutter without adding a comparison.
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
import { SOURCE_ORDER, sourceLabel, toMs } from "./components/network/series-data.js";
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
const DECAY_REFS = ["truth", "map"];
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

    // Re-render the hero cards for one source. Driven by the header
    // source switch so every crawl's own snapshot numbers, "as of"
    // date, and latest-update impact are one click apart. Each source
    // carries its own latest_update (node-impact scored on its newest
    // node set), so the impact card now follows the switch too.
    const renderHero = (source) => {
        const data = network.sources[source];
        const latest = data.snapshots[data.snapshots.length - 1];
        overview.mount(overviewSlot, {
            snapshot: latest,
            decay: data.decay,
            latestUpdate: data.latest_update ?? null,
            asOf: t("network.overview.snapshotMeta", {
                source: sourceLabel(source),
                date: formatDate(latest.label),
                build: formatDate(new Date(toMs(latest.build.timestamp))),
            }),
        });
    };
    renderHero(primary);

    // Source switch above the cards: only meaningful with more than one
    // crawler present, so it is omitted on single-source data.
    const heroSourceSlot = document.querySelector("[data-network-overview-source]");
    if (heroSourceSlot && presentSources.length > 1) {
        heroSourceSlot.replaceChildren(
            createModeSwitch({
                options: presentSources.map((s) => ({
                    value: s,
                    label: sourceLabel(s),
                })),
                value: primary,
                onChange: renderHero,
                ariaLabel: t("network.overview.sourceSwitchAria"),
            }),
        );
    }

    // A deep link can pin the Trends range plus the decay reference and
    // HHI family so a shared finding opens on the same view.
    const hash = readHashState(TAB);
    const requestedRange = hash.get("range");
    const requestedRef = hash.get("ref");
    const requestedFamily = hash.get("family");

    // Per-chart toggle state hoisted here so a range re-mount keeps
    // hidden series — and, for decay / HHI, the active reference or
    // family. The operator breakdown has no legend (its per-period cast
    // changes) but carries a source switch, so its picked crawl lives
    // here too and survives a range re-mount.
    const states = {
        decay: {
            hidden: new Set(),
            ref: DECAY_REFS.includes(requestedRef) ? requestedRef : "truth",
        },
        hhi: {
            hidden: new Set(),
            family: HHI_FAMILIES.includes(requestedFamily)
                ? requestedFamily
                : "all",
        },
        coverage: { hidden: new Set() },
        operators: { source: primary },
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
            ref: states.decay.ref !== "truth" ? states.decay.ref : null,
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
