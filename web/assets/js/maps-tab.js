import { formatDate } from "./format.js";
import * as overviewCards from "./components/overview-cards.js";
import * as mapSizeChart from "./components/map-size-chart.js";
import * as mapDeltaChart from "./components/map-delta-chart.js";
import * as diffExplorer from "./components/diff-explorer.js";

const METRICS_URL = "assets/data/metrics.json";

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

async function init() {
    let payload;
    try {
        payload = await load();
    } catch (error) {
        console.error(error);
        document.body.dataset.loadError = error.message;
        return;
    }

    renderLastBuild(payload.maps);
    overviewCards.mount(document.querySelector("[data-overview]"), payload.maps);
    mapSizeChart.mount(
        document.querySelector("[data-map-size-chart]"),
        payload.maps,
    );
    mapDeltaChart.mount(
        document.querySelector("[data-map-delta-chart]"),
        payload.maps,
    );
    diffExplorer.mount(document.querySelector("[data-diff]"), payload);
}

init();
