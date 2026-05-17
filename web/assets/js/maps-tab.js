// Maps tab: Overview cards (per-build snapshot) + History
// charts (drift, entries, per-release deltas).

import { daysBetween } from "./format.js";
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
import { t, tPlural } from "./utils/i18n.js";

// Bloomberg / TradingView convention for instant recognition.
const HISTORY_RANGE_VALUES = ["1y", "3y", "5y", "max"];

function renderBuildStaleness(map) {
    const slot = document.querySelector("[data-build-staleness]");
    if (!slot) return;
    if (!map) {
        slot.textContent = "";
        return;
    }
    const days = daysBetween(map.released_at);
    slot.textContent = tPlural("overview.staleness", days);
}

export function mount(payload) {
    const { maps } = payload;
    const diffs = payload.diffs || [];

    const overviewParent = document.querySelector("[data-overview]");
    const renderOverview = (name) => {
        const current = maps.find((m) => m.name === name);
        // Shared "vs previous" anchor across all three cards.
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

    // Tab-level so a range-picker re-mount preserves toggled
    // series. Drift cumulative and step keep separate sets.
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
            options: HISTORY_RANGE_VALUES.map((value) => ({
                value,
                label: t(`history.range.${value}`),
            })),
            value: historyRange,
            onChange: (next) => {
                historyRange = next;
                renderHistory();
            },
            ariaLabel: t("history.range.ariaLabel"),
        });
        historyRangeSlot.replaceChildren(picker);
    }

    renderHistory();
}
