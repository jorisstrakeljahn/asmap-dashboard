// Maps tab: Overview cards (per-build snapshot) + History
// charts (drift, entries, per-release deltas).

import { daysBetween } from "./format.js";
import * as overviewCards from "./components/overview-cards.js";
import * as buildSelector from "./components/build-selector.js";
import * as mapDeltaChart from "./components/map-delta-chart.js";
import * as driftChart from "./components/drift-chart.js";
import * as diversityChart from "./components/diversity-chart.js";
import * as entriesChart from "./components/entries-chart.js";
import { createModeSwitch } from "./components/mode-switch.js";
import {
    DRIFT_IPV4_COVERAGE,
    DRIFT_IPV6_COVERAGE,
    previousDiffable,
} from "./utils/diffs.js";
import {
    DEFAULT_HISTORY_RANGE,
    resolveHistoryRange,
} from "./utils/history-range.js";
import { t, tPlural } from "./utils/i18n.js";

// Bloomberg / TradingView convention for instant recognition.
const HISTORY_RANGE_VALUES = ["1y", "3y", "5y", "max"];

// Drift unit picker order. IPv4 first because it is the headline
// view (Bitcoin Core peer diversity weighs IPv4 reachability most
// directly), IPv6 second. The legacy entries view was dropped on
// purpose: it weights a /8 the same as a /48 and is the exact
// failure mode the coverage views were introduced to avoid.
const DRIFT_UNIT_VALUES = [
    DRIFT_IPV4_COVERAGE,
    DRIFT_IPV6_COVERAGE,
];

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

// ``diffsPromise`` resolves to the all-pairs diff list, which ships
// as a separate ~10 MB file (see app.js). Everything that does not
// need it (build selector, entries / diversity / delta charts)
// renders immediately; the drift views render once against an empty
// diff list (their built-in empty states cover the gap) and re-render
// when the diffs land. State objects live in this closure, so the
// late re-render keeps the reader's range / unit / legend choices.
export function mount(payload, diffsPromise = null) {
    const { maps } = payload;
    let diffs = payload.diffs || [];

    const overviewParent = document.querySelector("[data-overview]");
    let selectedName = maps.length ? maps[maps.length - 1].name : null;
    const renderOverview = (name) => {
        selectedName = name;
        const current = maps.find((m) => m.name === name);
        // Shared "vs previous" anchor across all three cards.
        overviewCards.mount(overviewParent, {
            current,
            previous: previousDiffable(maps, name),
            diffs,
        });
        renderBuildStaleness(current);
    };

    buildSelector.mount(
        document.querySelector("[data-build-selector]"),
        maps,
        selectedName,
        renderOverview,
    );
    renderOverview(selectedName);

    // History charts read a windowed slice of the maps array so
    // the range picker can swap the slice without each chart
    // needing its own filter. The overview cards and build
    // selector keep the full array because they describe
    // individual builds rather than a time range.
    const driftCumulativeSlot = document.querySelector(
        "[data-drift-cumulative-chart]",
    );
    const driftStepSlot = document.querySelector("[data-drift-step-chart]");
    const diversitySlot = document.querySelector("[data-diversity-chart]");
    const entriesSlot = document.querySelector("[data-entries-chart]");
    const deltaSlot = document.querySelector("[data-map-delta-chart]");

    // Tab-level so a range-picker re-mount preserves toggled
    // series. Drift cumulative and step keep separate sets.
    const driftCumulativeState = { hidden: new Set() };
    const driftStepState = { hidden: new Set() };
    const entriesState = { hidden: new Set() };

    let historyRange = DEFAULT_HISTORY_RANGE;
    // One unit selection drives both drift charts so the cumulative
    // and step views can never disagree on which "currency" the
    // user is reading. Per-card state would tempt mis-comparisons.
    let driftUnit = DRIFT_IPV4_COVERAGE;
    const renderHistory = () => {
        const slice = resolveHistoryRange(maps, historyRange);
        const bounds = {
            domainStart: slice.domainStart,
            domainEnd: slice.domainEnd,
        };
        driftChart.mount(driftCumulativeSlot, slice.maps, diffs, {
            ...bounds,
            mode: "cumulative",
            unit: driftUnit,
            state: driftCumulativeState,
        });
        driftChart.mount(driftStepSlot, slice.maps, diffs, {
            ...bounds,
            mode: "step",
            unit: driftUnit,
            state: driftStepState,
        });
        diversityChart.mount(diversitySlot, slice.maps, bounds);
        entriesChart.mount(entriesSlot, slice.maps, {
            ...bounds,
            state: entriesState,
        });
        mapDeltaChart.mount(deltaSlot, slice.maps, bounds);
    };

    const driftUnitSlot = document.querySelector("[data-drift-unit]");
    if (driftUnitSlot) {
        const picker = createModeSwitch({
            options: DRIFT_UNIT_VALUES.map((value) => ({
                value,
                label: t(`history.driftUnit.${value}.label`),
            })),
            value: driftUnit,
            onChange: (next) => {
                driftUnit = next;
                renderHistory();
            },
            ariaLabel: t("history.driftUnit.ariaLabel"),
        });
        driftUnitSlot.replaceChildren(picker);
    }

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

    if (diffsPromise) {
        diffsPromise
            .then((loaded) => {
                diffs = loaded || [];
                renderOverview(selectedName);
                renderHistory();
            })
            .catch((error) => {
                // The non-diff views are already up; the drift slots
                // keep their empty-state notes. app.js reports the
                // failure on the Diff Explorer panel.
                console.error(error);
            });
    }
}
