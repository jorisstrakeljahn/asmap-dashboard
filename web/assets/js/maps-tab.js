import { formatDate } from "./format.js";
import * as asnNames from "./asn-names.js";
import * as overviewCards from "./components/overview-cards.js";
import * as buildSelector from "./components/build-selector.js";
import * as mapSizeChart from "./components/map-size-chart.js";
import * as mapDeltaChart from "./components/map-delta-chart.js";
import * as diffExplorer from "./components/diff-explorer.js";

const METRICS_URL = "assets/data/metrics.json";
const ASN_NAMES_URL = "assets/data/asn-names.json";

async function load() {
    const response = await fetch(METRICS_URL);
    if (!response.ok) {
        throw new Error(
            `Failed to load ${METRICS_URL}: HTTP ${response.status}`,
        );
    }
    return await response.json();
}

function renderLastBuild(maps) {
    const slot = document.querySelector("[data-last-build]");
    if (!slot || !maps.length) return;
    const latest = maps[maps.length - 1];
    slot.textContent = `Last build ${formatDate(latest.released_at)}`;
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
    let payload;
    // Names load in parallel with metrics so the table can render with
    // labels in the same tick; a missing names file is non-fatal.
    try {
        [payload] = await Promise.all([
            load(),
            asnNames.init(ASN_NAMES_URL),
        ]);
    } catch (error) {
        console.error(error);
        document.body.dataset.loadError = error.message;
        return;
    }

    const { maps } = payload;
    renderLastBuild(maps);

    const overviewParent = document.querySelector("[data-overview]");
    const renderOverview = (name) => {
        const current = maps.find((m) => m.name === name);
        overviewCards.mount(overviewParent, current, previousMap(maps, name));
    };

    const defaultName = maps.length ? maps[maps.length - 1].name : null;
    buildSelector.mount(
        document.querySelector("[data-build-selector]"),
        maps,
        defaultName,
        renderOverview,
    );
    renderOverview(defaultName);

    mapSizeChart.mount(document.querySelector("[data-map-size-chart]"), maps);
    mapDeltaChart.mount(document.querySelector("[data-map-delta-chart]"), maps);
    diffExplorer.mount(document.querySelector("[data-diff]"), payload);
}

init();
