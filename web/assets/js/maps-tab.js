// Maps tab: the Overview cards (per-build snapshot) plus the
// History section (drift, entries, and per-release deltas).
//
// The Diff Explorer lives in its own tab now (see diff-tab.js).
// Splitting the two surfaces lets the Maps tab read as a tight
// "what is this build, and where has the project trended" view
// without the larger compare table in the middle.

import { daysBetween, formatNumber } from "./format.js";
import * as overviewCards from "./components/overview-cards.js";
import * as buildSelector from "./components/build-selector.js";
import * as mapDeltaChart from "./components/map-delta-chart.js";
import * as driftChart from "./components/drift-chart.js";
import * as entriesChart from "./components/entries-chart.js";
import { createModeSwitch } from "./components/mode-switch.js";
import { previousDiffable } from "./utils/diffs.js";
import {
    DEFAULT_HISTORY_RANGE,
    resolveHistoryRange,
} from "./utils/history-range.js";

// History range picker labels. Matches Bloomberg / TradingView
// convention so the affordance is recognisable on first sight.
// "Max" is the explicit name for the full-history view rather
// than an unlabelled default, so the picker is fully self-
// describing when read out by a screen reader.
const HISTORY_RANGE_OPTIONS = [
    { value: "1y", label: "1Y" },
    { value: "3y", label: "3Y" },
    { value: "5y", label: "5Y" },
    { value: "max", label: "Max" },
];

// Inline staleness next to the build selector. Shown as plain
// text so the build picker remains the dominant control — the
// age is a subordinate detail, not a metric in its own right.
function renderBuildStaleness(map) {
    const slot = document.querySelector("[data-build-staleness]");
    if (!slot) return;
    if (!map) {
        slot.textContent = "";
        return;
    }
    const days = daysBetween(map.released_at);
    slot.textContent = days === 1
        ? "1 day old"
        : `${formatNumber(days)} days old`;
}

/**
 * Mount the Maps tab panel.
 * @param {object} payload - parsed metrics.json contents.
 */
export function mount(payload) {
    const { maps } = payload;
    const diffs = payload.diffs || [];

    const overviewParent = document.querySelector("[data-overview]");
    const renderOverview = (name) => {
        const current = maps.find((m) => m.name === name);
        // All three overview cards share the same predecessor:
        // the most recent build with an unfilled variant. The
        // drift card needs it (drift is unfilled-vs-unfilled), and
        // anchoring the entries and unique-ASes deltas to the same
        // build keeps the three cards telling one consistent
        // "what changed against <date>?" story.
        overviewCards.mount(overviewParent, {
            current,
            previous: previousDiffable(maps, name),
            diffs,
        });
        renderBuildStaleness(current);
    };

    const defaultName = maps.length ? maps[maps.length - 1].name : null;
    buildSelector.mount(
        document.querySelector("[data-build-selector]"),
        maps,
        defaultName,
        renderOverview,
    );
    renderOverview(defaultName);

    // History charts read a windowed slice of the maps array so
    // the range picker can swap the slice without each chart
    // needing its own filter. The overview cards and build
    // selector keep the full array because they describe
    // individual builds rather than a time range.
    const driftCumulativeSlot = document.querySelector(
        "[data-drift-cumulative-chart]",
    );
    const driftStepSlot = document.querySelector("[data-drift-step-chart]");
    const entriesSlot = document.querySelector("[data-entries-chart]");
    const deltaSlot = document.querySelector("[data-map-delta-chart]");

    // Per-chart state lives at the tab level so toggling a series
    // off survives a range-picker change: the picker re-mounts
    // each chart, but every mount receives the same state object
    // the previous mount mutated. Set instances stay stable so
    // the new legend's "is in hidden" checks keep matching what
    // the user toggled before. Drift cumulative and step keep
    // separate hidden sets so a reader can isolate a category in
    // one mode without yanking it out of the other.
    const driftCumulativeState = { hidden: new Set() };
    const driftStepState = { hidden: new Set() };
    const entriesState = { hidden: new Set() };

    let historyRange = DEFAULT_HISTORY_RANGE;
    const renderHistory = () => {
        const slice = resolveHistoryRange(maps, historyRange);
        const bounds = {
            domainStart: slice.domainStart,
            domainEnd: slice.domainEnd,
        };
        driftChart.mount(driftCumulativeSlot, slice.maps, diffs, {
            ...bounds,
            mode: "cumulative",
            state: driftCumulativeState,
        });
        driftChart.mount(driftStepSlot, slice.maps, diffs, {
            ...bounds,
            mode: "step",
            state: driftStepState,
        });
        entriesChart.mount(entriesSlot, slice.maps, {
            ...bounds,
            state: entriesState,
        });
        mapDeltaChart.mount(deltaSlot, slice.maps, bounds);
    };

    const historyRangeSlot = document.querySelector("[data-history-range]");
    if (historyRangeSlot) {
        const picker = createModeSwitch({
            options: HISTORY_RANGE_OPTIONS,
            value: historyRange,
            onChange: (next) => {
                historyRange = next;
                renderHistory();
            },
            ariaLabel: "History time range",
        });
        historyRangeSlot.replaceChildren(picker);
    }

    renderHistory();
}
