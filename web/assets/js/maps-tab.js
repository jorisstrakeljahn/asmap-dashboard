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
    readHashState,
    writeHashState,
} from "./utils/hash-state.js";
import {
    DEFAULT_HISTORY_RANGE,
    HISTORY_RANGE_VALUES,
    resolveHistoryRange,
} from "./utils/history-range.js";
import { t, tPlural } from "./utils/i18n.js";

// Drift unit picker order. IPv4 first because it is the headline
// view (Bitcoin Core peer diversity weighs IPv4 reachability most
// directly), IPv6 second. The legacy entries view was dropped on
// purpose: it weights a /8 the same as a /48 and is the exact
// failure mode the coverage views were introduced to avoid.
const DRIFT_UNIT_VALUES = [
    DRIFT_IPV4_COVERAGE,
    DRIFT_IPV6_COVERAGE,
];

// Maps is the default tab, so it stamps its view state onto an empty
// hash (see utils/hash-state.js). The drift-unit constants are internal
// ("ipv4_coverage"); the URL uses short, readable tokens.
const TAB = "maps";
const UNIT_TO_TOKEN = {
    [DRIFT_IPV4_COVERAGE]: "ipv4",
    [DRIFT_IPV6_COVERAGE]: "ipv6",
};
const TOKEN_TO_UNIT = {
    ipv4: DRIFT_IPV4_COVERAGE,
    ipv6: DRIFT_IPV6_COVERAGE,
};

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

    // A deep link can pin the Overview build, drift unit, and history
    // range so a finding shared in a PR review opens on the same view.
    const hash = readHashState(TAB);
    const requestedBuild = hash.get("build");
    const requestedUnit = TOKEN_TO_UNIT[hash.get("unit")];
    const requestedRange = hash.get("range");

    // One unit selection drives both drift charts so the cumulative and
    // step views can never disagree on which "currency" the reader is
    // looking at. Range windows every History chart's x-axis. Both seed
    // from the hash when a deep link supplies a valid value.
    let driftUnit = requestedUnit ?? DRIFT_IPV4_COVERAGE;
    let historyRange = HISTORY_RANGE_VALUES.includes(requestedRange)
        ? requestedRange
        : DEFAULT_HISTORY_RANGE;

    // Write the current view back to the hash. Only non-default selections
    // are emitted, so the default Maps view stays on a bare URL with nothing
    // to share. The guard in writeHashState makes this a no-op unless Maps
    // owns the hash (or it is the empty default), so an inactive tab's
    // re-render never hijacks the URL.
    const syncUrl = () => {
        const current = maps.find((m) => m.name === selectedName);
        writeHashState(
            TAB,
            {
                build:
                    selectedName !== defaultName ? current?.released_at : null,
                unit:
                    driftUnit !== DRIFT_IPV4_COVERAGE
                        ? UNIT_TO_TOKEN[driftUnit]
                        : null,
                range:
                    historyRange !== DEFAULT_HISTORY_RANGE ? historyRange : null,
            },
            { stampWhenEmpty: true },
        );
    };

    const overviewParent = document.querySelector("[data-overview]");
    const defaultName = maps.length ? maps[maps.length - 1].name : null;
    const requestedName = requestedBuild
        ? (maps.find((m) => m.released_at === requestedBuild)?.name ?? null)
        : null;
    let selectedName = requestedName ?? defaultName;
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
        syncUrl();
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

    const renderHistory = () => {
        syncUrl();
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
