// Entry point for the Maps tab: loads metrics.json plus the ASN
// names lookup, mounts the overview cards, the size and delta
// charts, and the diff explorer, and wires the build selector
// that scopes the overview to a single published map.

import { daysBetween, formatDate, formatNumber } from "./format.js";
import * as asnNames from "./asn-names.js";
import * as overviewCards from "./components/overview-cards.js";
import * as buildSelector from "./components/build-selector.js";
import * as mapSizeChart from "./components/map-size-chart.js";
import * as mapDeltaChart from "./components/map-delta-chart.js";
import * as driftChart from "./components/drift-chart.js";
import * as diffExplorer from "./components/diff-explorer.js";
import { createModeSwitch } from "./components/mode-switch.js";
import { DEFAULT_MAPS_VIEW, viewWindow } from "./utils/maps-view.js";

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

const METRICS_URL = "assets/data/metrics.json";
const ASN_NAMES_URL = "assets/data/asn-names.json";

// metrics.json stays byte-stable across runs whenever the upstream
// .dat files haven't changed (see asmap_dashboard/metrics.py), so
// the file's Last-Modified header is the most accurate signal of
// "when did the dashboard's data actually refresh". Reading it
// keeps the timestamp out of the JSON payload itself, which would
// otherwise force a daily commit even on no-op refresh runs.
async function loadMetrics() {
    const response = await fetch(METRICS_URL);
    if (!response.ok) {
        throw new Error(
            `Failed to load ${METRICS_URL}: HTTP ${response.status}`,
        );
    }
    const data = await response.json();
    return { data, lastModified: response.headers.get("Last-Modified") };
}

function renderLastBuild(maps) {
    const slot = document.querySelector("[data-last-build]");
    if (!slot || !maps.length) return;
    const latest = maps[maps.length - 1];
    slot.textContent = `Last build ${formatDate(latest.released_at)}`;
}

// Inline staleness next to the build selector. Shown as plain text
// so the build picker remains the dominant control - the age is a
// subordinate detail, not a metric in its own right.
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

// Render the footer's "Last update <UTC timestamp>" line. The line
// stays hidden when the server doesn't expose Last-Modified - typical
// for file:// loads - so we never show an empty timestamp slot.
function renderLastRefreshed(lastModified) {
    const line = document.querySelector("[data-last-refreshed]");
    if (!line) return;
    const date = lastModified ? new Date(lastModified) : null;
    if (!date || Number.isNaN(date.getTime())) return;
    line.textContent = `Last update ${formatUtcStamp(date)}`;
    line.hidden = false;
}

// "2026-05-12 14:01 UTC" - matches the style bitdis.org uses for
// its data-refresh footer. ISO-style date so it sorts naturally
// and reads the same in every locale.
function formatUtcStamp(date) {
    const pad = (n) => String(n).padStart(2, "0");
    const yyyy = date.getUTCFullYear();
    const mm = pad(date.getUTCMonth() + 1);
    const dd = pad(date.getUTCDate());
    const hh = pad(date.getUTCHours());
    const mi = pad(date.getUTCMinutes());
    return `${yyyy}-${mm}-${dd} ${hh}:${mi} UTC`;
}

// metrics.json keeps maps in chronological order (oldest first), so the
// previous build is simply the one stored at idx - 1. Returns null when
// the selected build is the oldest one, which is exactly what the cards
// expect to skip the "vs previous" delta line.
function previousMap(maps, name) {
    const idx = maps.findIndex((m) => m.name === name);
    return idx > 0 ? maps[idx - 1] : null;
}

async function init() {
    let metrics;
    // Names load in parallel with metrics so the table can render with
    // labels in the same tick; a missing names file is non-fatal.
    try {
        [metrics] = await Promise.all([
            loadMetrics(),
            asnNames.init(ASN_NAMES_URL),
        ]);
    } catch (error) {
        console.error(error);
        document.body.dataset.loadError = error.message;
        return;
    }

    const { data: payload, lastModified } = metrics;
    const { maps } = payload;
    renderLastBuild(maps);
    renderLastRefreshed(lastModified);

    const overviewParent = document.querySelector("[data-overview]");
    const diffs = payload.diffs || [];
    const renderOverview = (name) => {
        const current = maps.find((m) => m.name === name);
        overviewCards.mount(
            overviewParent,
            current,
            previousMap(maps, name),
            diffs,
        );
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

    // History charts read a windowed slice of the maps array so the
    // range picker can swap the slice without each chart needing
    // its own filter. The overview cards, build selector, and diff
    // explorer keep the full array because they describe individual
    // builds rather than a time range.
    const sizeSlot = document.querySelector("[data-map-size-chart]");
    const deltaSlot = document.querySelector("[data-map-delta-chart]");
    const driftSlot = document.querySelector("[data-drift-chart]");

    // Per-chart state lives at the tab level so toggling a series
    // off or switching the drift mode survives a range-picker
    // change: the picker re-mounts each chart, but every mount
    // receives the same state object the previous mount mutated.
    // Set instances stay stable so the new legend's "is in hidden"
    // checks keep matching what the user toggled before.
    const mapSizeState = { hidden: new Set() };
    const driftState = { mode: "cumulative", hidden: new Set() };

    let historyView = DEFAULT_MAPS_VIEW;
    const renderHistory = () => {
        const window = viewWindow(maps, historyView);
        const bounds = {
            domainStart: window.domainStart,
            domainEnd: window.domainEnd,
        };
        mapSizeChart.mount(sizeSlot, window.maps, {
            ...bounds,
            state: mapSizeState,
        });
        mapDeltaChart.mount(deltaSlot, window.maps, bounds);
        driftChart.mount(driftSlot, window.maps, diffs, {
            ...bounds,
            state: driftState,
        });
    };

    const historyRangeSlot = document.querySelector("[data-history-range]");
    if (historyRangeSlot) {
        const picker = createModeSwitch({
            options: HISTORY_RANGE_OPTIONS,
            value: historyView,
            onChange: (next) => {
                historyView = next;
                renderHistory();
            },
            ariaLabel: "History time range",
        });
        historyRangeSlot.replaceChildren(picker);
    }

    renderHistory();
    diffExplorer.mount(document.querySelector("[data-diff]"), payload);
}

init();
