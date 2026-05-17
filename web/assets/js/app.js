// Top-level entry point for the dashboard.
//
// Loads the two data files (metrics + ASN names) once, hands the
// resulting payload to every tab module, and wires the tab
// router. Each tab module owns its own DOM region and renders
// independently; this file is intentionally only the bootstrap
// loader so a contributor reading it gets a single high-level
// view of "what gets mounted where".

import * as asnNames from "./asn-names.js";
import { initTabs } from "./tabs.js";
import * as mapsTab from "./maps-tab.js";
import * as diffTab from "./diff-tab.js";

const METRICS_URL = "assets/data/metrics.json";
const ASN_NAMES_URL = "assets/data/asn-names.json";

// Snapshot of the static tab-panel markup before any tab module
// has had a chance to swap in its rendered DOM. Captured once at
// module load so we can put it back when the user clicks "Try
// again" on the error banner: renderLoadError replaces every
// child of <main> with the banner, and the tab modules expect
// the original [data-overview], [data-diff], ... slots to exist
// when they re-mount.
let mainTemplate = null;

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

// Render the footer's "Last update <UTC timestamp>" line. The line
// stays hidden when the server doesn't expose Last-Modified —
// typical for file:// loads — so we never show an empty timestamp
// slot.
function renderLastRefreshed(lastModified) {
    const line = document.querySelector("[data-last-refreshed]");
    if (!line) return;
    const date = lastModified ? new Date(lastModified) : null;
    if (!date || Number.isNaN(date.getTime())) return;
    line.textContent = `Last update ${formatUtcStamp(date)}`;
    line.hidden = false;
}

// "2026-05-12 14:01 UTC" — matches the style bitdis.org uses for
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

async function init() {
    if (mainTemplate === null) {
        const main = document.querySelector("main.content");
        mainTemplate = main ? main.innerHTML : "";
    }

    let metrics;
    // Names load in parallel with metrics so the table can render
    // with labels in the same tick; a missing names file is non-
    // fatal.
    try {
        [metrics] = await Promise.all([
            loadMetrics(),
            asnNames.init(ASN_NAMES_URL),
        ]);
    } catch (error) {
        console.error(error);
        renderLoadError(error);
        return;
    }

    const { data: payload, lastModified } = metrics;
    renderLastRefreshed(lastModified);

    mapsTab.mount(payload);
    diffTab.mount(payload);

    // Default to the Maps tab when no hash is supplied. The tab
    // router still honours #diff for direct links and respects
    // hashchange events thereafter.
    initTabs({ defaultTab: "maps" });
}

// Re-run init() in place when the user clicks "Try again" on the
// error banner. Restores the original tab-panel markup (the tab
// modules need their [data-*] slots back) and re-runs the load.
// We do not call location.reload() because a transient network
// blip recovers in seconds and a reload throws away any scroll
// position / tab selection the user had before the failure.
async function retryInit() {
    const main = document.querySelector("main.content");
    if (main && mainTemplate !== null) {
        main.innerHTML = mainTemplate;
    }
    await init();
}

// Render a visible error banner into <main> when the data fetch
// fails. Previously this branch only stamped a dataset attribute
// on <body> that no stylesheet consumed, leaving the user with a
// blank page and no signal that anything had gone wrong. Showing
// the underlying message makes a CI / hosting outage debuggable
// from the dashboard itself instead of requiring devtools.
function renderLoadError(error) {
    const main = document.querySelector("main.content");
    if (!main) return;
    const banner = document.createElement("section");
    banner.className = "load-error";
    banner.setAttribute("role", "alert");

    const title = document.createElement("h2");
    title.className = "load-error__title";
    title.textContent = "Could not load dashboard data";

    const body = document.createElement("p");
    body.className = "load-error__body";
    body.textContent = error?.message
        ? `${error.message}. The site usually recovers on the next daily refresh.`
        : "The metrics file is unreachable. The site usually recovers on the next daily refresh.";

    // "Try again" runs init() in place rather than reloading the
    // document. The button disables itself while the retry is
    // pending so a frustrated double-click can't trigger two
    // concurrent fetches that race each other.
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "load-error__retry";
    retry.textContent = "Try again";
    retry.addEventListener("click", async () => {
        retry.disabled = true;
        retry.textContent = "Retrying\u2026";
        try {
            await retryInit();
        } catch (e) {
            console.error(e);
            retry.disabled = false;
            retry.textContent = "Try again";
        }
    });

    main.replaceChildren(banner);
    banner.append(title, body, retry);
}

init();
