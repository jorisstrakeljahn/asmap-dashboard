// Bootstrap. Loads data + i18n in parallel, then hands the
// payload to the tab modules.

import * as asnNames from "./asn-names.js";
import { initTabs } from "./tabs.js";
import * as mapsTab from "./maps-tab.js";
import * as diffTab from "./diff-tab.js";
import * as networkTab from "./network-tab.js";
import { applyDomTranslations, loadStrings, t } from "./utils/i18n.js";

const METRICS_URL = "assets/data/metrics.json";
const ASN_NAMES_URL = "assets/data/asn-names.json";
const I18N_URL = "assets/i18n/en.json";

// Snapshot of the static tab-panel markup, captured before any
// tab module swaps in rendered DOM. The retry button on the
// error banner restores this so [data-overview], [data-diff],
// ... slots exist when the tabs re-mount.
let mainTemplate = null;

// metrics.json stays byte-stable across no-op refreshes (see
// metrics.py), so Last-Modified is the most accurate "data
// last refreshed" signal — and avoids stamping a timestamp into
// the JSON, which would force a daily commit.
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

// Hidden when Last-Modified is absent (file:// loads) so an
// empty timestamp slot never ships.
function renderLastRefreshed(lastModified) {
    const line = document.querySelector("[data-last-refreshed]");
    if (!line) return;
    const date = lastModified ? new Date(lastModified) : null;
    if (!date || Number.isNaN(date.getTime())) return;
    line.textContent = t("footer.lastUpdate", { timestamp: formatUtcStamp(date) });
    line.hidden = false;
}

// "2026-05-12 14:01 UTC" — ISO-style so it sorts naturally and
// reads the same in every locale.
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
    // Single parallel batch (no extra round-trips). loadStrings
    // swallows its own failures, so an i18n outage does not block
    // the chart / table mounts.
    try {
        [metrics] = await Promise.all([
            loadMetrics(),
            asnNames.init(ASN_NAMES_URL),
            loadStrings(I18N_URL),
        ]);
    } catch (error) {
        console.error(error);
        renderLoadError(error);
        return;
    }

    applyDomTranslations();

    const { data: payload, lastModified } = metrics;
    renderLastRefreshed(lastModified);

    mapsTab.mount(payload);
    diffTab.mount(payload);

    // The Network tab is opt-in: it only renders when metrics.json
    // carries a ``network`` section (i.e. snapshot data was passed at
    // generation time). When absent, its nav entry stays hidden so the
    // public deploy never shows an empty tab.
    const hasNetwork = networkTab.mount(payload);
    revealNetworkNav(hasNetwork);

    initTabs({ defaultTab: "maps" });
}

// Show the Network nav link only when the tab actually mounted.
// The link ships ``hidden`` in the static markup so a payload
// without a network section never flashes an empty tab.
function revealNetworkNav(hasNetwork) {
    const link = document.querySelector("[data-network-nav]");
    if (link) link.hidden = !hasNetwork;
}

// In-place retry (not location.reload()) so a transient blip
// does not throw away scroll position / tab selection.
async function retryInit() {
    const main = document.querySelector("main.content");
    if (main && mainTemplate !== null) {
        main.innerHTML = mainTemplate;
    }
    await init();
}

function renderLoadError(error) {
    const main = document.querySelector("main.content");
    if (!main) return;
    const banner = document.createElement("section");
    banner.className = "load-error";
    banner.setAttribute("role", "alert");

    const title = document.createElement("h2");
    title.className = "load-error__title";
    title.textContent = t("loadError.title");

    const body = document.createElement("p");
    body.className = "load-error__body";
    body.textContent = error?.message
        ? t("loadError.bodyWithMessage", { message: error.message })
        : t("loadError.bodyDefault");

    // disabled during retry so a double-click cannot race
    // two concurrent fetches.
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "load-error__retry";
    retry.textContent = t("loadError.retry");
    retry.addEventListener("click", async () => {
        retry.disabled = true;
        retry.textContent = t("loadError.retrying");
        try {
            await retryInit();
        } catch (e) {
            console.error(e);
            retry.disabled = false;
            retry.textContent = t("loadError.retry");
        }
    });

    main.replaceChildren(banner);
    banner.append(title, body, retry);
}

init();
