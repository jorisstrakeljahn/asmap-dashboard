// Bootstrap. Loads data + i18n in parallel, then hands the
// payload to the tab modules.

import * as asnNames from "./asn-names.js";
import { initNavMenu } from "./components/nav-menu.js";
import { initThemeSwitch, localizeThemeSwitch } from "./components/theme-switch.js";
import { initTabs } from "./tabs.js";
import * as mapsTab from "./maps-tab.js";
import * as diffTab from "./diff-tab.js";
import * as networkTab from "./network-tab.js";
import { applyDomTranslations, loadStrings, t } from "./utils/i18n.js";

// The data layer is split by size (see cli.py): metrics.json holds
// the maps + per-pair diff summary (~100 KB), diffs.json the heavy
// top-mover rosters (~99% of diff bytes), network.json the optional
// KIT/Bitnodes section (~30 KB). metrics.json + network.json drive
// the first paint; diffs.json loads lazily when the Diff Explorer
// opens (see ensureDiffMounted).
const METRICS_URL = "assets/data/metrics.json";
const DIFFS_URL = "assets/data/diffs.json";
const NETWORK_URL = "assets/data/network.json";
const ASN_NAMES_URL = "assets/data/asn-names.json";
const I18N_URL = "assets/i18n/en.json";

// Mirrors SCHEMA_VERSION in asmap_dashboard/metrics.py. GitHub Pages
// caches assets ~10 min, so post-deploy a browser can pair a stale
// app.js with a fresh payload (or vice versa). Checking the payload
// version turns silent nonsense (0.0% drift) into a reload banner.
const EXPECTED_SCHEMA_VERSION = 4;

// Snapshot of the static tab-panel markup, captured before any tab
// module swaps in rendered DOM. The error banner's retry button
// restores it so the [data-*] slots exist when tabs re-mount.
let mainTemplate = null;

// Payloads stay byte-stable across no-op refreshes (see metrics.py),
// so Last-Modified is the best "data last refreshed" signal without
// stamping a timestamp into the JSON (which would force a daily
// commit).
//
// ``optional`` turns a 404 into ``null`` (network.json only exists
// when KIT data was available at generation time). A schema mismatch
// is retried once with cache "reload" to heal a stale CDN/browser
// cache entry before giving up with the reload banner.
async function loadPayload(url, { optional = false } = {}) {
    let result = await fetchPayload(url, { optional });
    if (result && result.data.schema_version !== EXPECTED_SCHEMA_VERSION) {
        result = await fetchPayload(url, { optional, cache: "reload" });
    }
    if (result && result.data.schema_version !== EXPECTED_SCHEMA_VERSION) {
        // Plain English on purpose: this error can fire before the
        // i18n strings have loaded, and it must stay readable then.
        const got = result.data.schema_version ?? "none";
        throw new Error(
            `${url} carries data schema v${got} but this page expects ` +
                `v${EXPECTED_SCHEMA_VERSION}. A cached file is out of ` +
                "date. Please hard-reload (Cmd/Ctrl+Shift+R).",
        );
    }
    return result;
}

async function fetchPayload(url, { optional = false, cache } = {}) {
    const response = await fetch(url, cache ? { cache } : undefined);
    if (!response.ok) {
        if (optional && response.status === 404) return null;
        throw new Error(`Failed to load ${url}: HTTP ${response.status}`);
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
    let network;
    // Single parallel batch. The heavy diffs.json is deliberately
    // excluded (lazy-loaded; see ensureDiffMounted). loadStrings
    // swallows its own failures, so an i18n outage does not block
    // the chart / table mounts.
    try {
        [metrics, network] = await Promise.all([
            loadPayload(METRICS_URL),
            loadPayload(NETWORK_URL, { optional: true }),
            asnNames.init(ASN_NAMES_URL),
            loadStrings(I18N_URL),
        ]);
    } catch (error) {
        console.error(error);
        renderLoadError(error);
        return;
    }

    applyDomTranslations();
    // The theme switch mounted with English fallback labels at module
    // load; now that the dictionary is in, swap in localised labels.
    localizeThemeSwitch(themeSwitch);

    const { data: payload, lastModified } = metrics;
    renderLastRefreshed(lastModified);

    // Maps tab renders from metrics.json alone: the diff summary its
    // drift views need ships in that file, so the charts paint
    // immediately without waiting on the heavy roster file.
    mapsTab.mount(payload);

    // Optional node impact for the Diff Explorer's per-pair banner;
    // null when network.json is absent or predates the field, and
    // the explorer degrades gracefully.
    const pairImpact = network?.data?.network?.pair_impact ?? null;

    // Fetch the heavy diffs.json lazily on first Diff-tab activation,
    // then graft each pair's roster onto the summary diff (keyed by
    // "<from>|<to>") so the explorer sees its usual shape. Only the
    // Top Movers table waits on this; the banner and drift come from
    // the summary. Guarded so a re-open never re-fetches.
    let diffMountStarted = false;
    const ensureDiffMounted = () => {
        if (diffMountStarted) return;
        diffMountStarted = true;
        diffTab.mountLoading();
        loadPayload(DIFFS_URL)
            .then(({ data }) => {
                const rosters = data.top_movers ?? {};
                const diffs = (payload.diffs ?? []).map((diff) => ({
                    ...diff,
                    top_movers: rosters[`${diff.from}|${diff.to}`] ?? [],
                }));
                diffTab.mount({ ...payload, diffs, pairImpact });
            })
            .catch((error) => {
                console.error(error);
                renderDiffLoadError(error);
            });
    };

    // The Network tab is opt-in: it only renders when network.json
    // exists. When absent, its nav entry stays hidden so the public
    // deploy never shows an empty tab.
    const hasNetwork = networkTab.mount(network?.data ?? null);
    revealNetworkNav(hasNetwork);

    initTabs({
        defaultTab: "maps",
        onActivate: (tab) => {
            if (tab === "diff") ensureDiffMounted();
        },
    });
}

function renderDiffLoadError(error) {
    const slot = document.querySelector("[data-diff]");
    if (!slot) return;
    const note = document.createElement("p");
    note.className = "muted";
    note.setAttribute("role", "alert");
    note.textContent = error?.message
        ? t("loadError.bodyWithMessage", { message: error.message })
        : t("loadError.bodyDefault");
    slot.replaceChildren(note);
}

// Show the Network nav link only when the tab actually mounted. The
// link ships ``hidden`` so a payload without a network section never
// flashes an empty tab. The availability is remembered so the inline
// pre-paint script in index.html can reveal the link on the next reload
// without waiting for this fetch — killing the header reflow for anyone
// who has seen the tab before.
function revealNetworkNav(hasNetwork) {
    const link = document.querySelector("[data-network-nav]");
    if (link) link.hidden = !hasNetwork;
    try {
        localStorage.setItem("asmap.network", hasNetwork ? "1" : "0");
    } catch {
        /* storage unavailable: the link still toggled above, we just
           cannot pre-empt the reflow on the next load. */
    }
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

// Wired once outside init(): the header markup is static and survives
// the in-place retry (which only rebuilds main.content), so this
// avoids double-binding the burger listeners and keeps the theme
// switch live even if the data fetch fails. localizeThemeSwitch runs
// later, once the i18n dictionary has loaded.
initNavMenu();
const themeSwitch = initThemeSwitch();

init();
