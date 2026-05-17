// Overview row at the top of the Maps tab. Three cards give a
// snapshot of the selected build:
//
//   - how many mappings it carries
//   - how many unique ASes those mappings cover, with IPv4 / IPv6
//     split
//   - how far it drifted from the previous build
//
// Each card carries a "vs previous" delta when a chronologically
// preceding build is available. Build age sits inline on the
// section toolbar. Raw file size lives in the History charts.
//
// All cards read the unfilled variant by default and fall back to
// filled when unfilled was not published for a build (see
// utils/variants.js for the rule). When the fallback fires, a small
// "filled fallback" badge appears on the card so the reader knows
// the number is not from source data.

import {
    formatDate,
    formatNumber,
    formatPercent,
    formatSignedNumber,
} from "../format.js";
import { tweenNumber } from "../utils/animate.js";
import { pairDriftRatio } from "../utils/diffs.js";
import { mutedNote } from "../utils/dom.js";
import {
    pickPreferUnfilled,
    unfilledProfile,
} from "../utils/variants.js";
import { createInfoTooltip } from "./info-tooltip.js";

// Metric keys used by the count-up tween: data-metric-key on each
// headline node lets us match "the new Entries metric" to "the old
// Entries metric" across a re-render so the tween reads from the
// previous value instead of from zero. The three keys are stable
// even when the underlying number changes type (e.g. drift goes
// from "—" to "5.0 %") because the lookup also tracks whether the
// previous value was tweenable at all.
const METRIC_KEY_ENTRIES = "entries";
const METRIC_KEY_UNIQUE_ASES = "unique-ases";
const METRIC_KEY_DRIFT = "drift";

/**
 * Render the three overview cards for the selected build.
 *
 * @param {HTMLElement} parent - card-row container.
 * @param {object} ctx
 * @param {object} ctx.current - the selected map record.
 * @param {object|null} ctx.previous - the most recent preceding
 *   build that has an unfilled variant (typically the immediate
 *   chronological neighbour, but bridges across any filled-only
 *   build in between). All three cards anchor their "vs previous"
 *   readings on this same build so the row tells one consistent
 *   "what changed against <date>?" story; the drift card spells
 *   the date out on its delta line as the row's shared anchor.
 * @param {Array} ctx.diffs - precomputed pair-diff records.
 */
export function mount(parent, { current, previous, diffs }) {
    if (!current) {
        parent.replaceChildren(mutedNote("No published maps found in metrics.json."));
        return;
    }
    const currentPick = pickPreferUnfilled(current);
    if (!currentPick) {
        parent.replaceChildren(
            mutedNote(`Build ${current.name} has no published variant data.`),
        );
        return;
    }
    // Snapshot the previous metric values BEFORE replaceChildren
    // tears the old cards out of the DOM. Used by the count-up
    // tween below; an absent key (first render, or the previous
    // card had no numeric value) just means the new value is
    // painted in place without animation.
    const previousValues = readPreviousValues(parent);

    const previousPick = pickPreferUnfilled(previous);
    const row = document.createElement("div");
    row.className = "card-row";
    row.append(
        entriesCountCard(currentPick, previousPick),
        uniqueAsesCard(currentPick, previousPick),
        driftCard(current, previous, diffs),
    );
    parent.replaceChildren(row);

    // After the new cards are in the document, tween every
    // headline number from its previous value to the new one.
    // Cards whose headline is non-numeric (e.g. an em-dash on a
    // filled-only build) ship through with no tween because the
    // node carries no data-metric-value.
    applyTweens(parent, previousValues);
}

function readPreviousValues(parent) {
    const out = {};
    const nodes = parent.querySelectorAll("[data-metric-key]");
    for (const node of nodes) {
        const key = node.dataset.metricKey;
        const raw = node.dataset.metricValue;
        if (key && raw !== undefined) {
            const num = Number(raw);
            if (Number.isFinite(num)) out[key] = num;
        }
    }
    return out;
}

function applyTweens(parent, previousValues) {
    const nodes = parent.querySelectorAll("[data-metric-key]");
    for (const node of nodes) {
        const key = node.dataset.metricKey;
        const raw = node.dataset.metricValue;
        if (!key || raw === undefined) continue;
        const to = Number(raw);
        if (!Number.isFinite(to)) continue;
        const from = previousValues[key];
        // First render or non-numeric previous: paint directly.
        if (!Number.isFinite(from) || from === to) continue;
        const format = pickFormatter(key);
        tweenNumber(node, { from, to, format });
    }
}

function pickFormatter(key) {
    if (key === METRIC_KEY_DRIFT) {
        return (n) => formatPercent(n, 1);
    }
    return (n) => formatNumber(Math.round(n));
}

// Entries are the (prefix, ASN) tuples the binary trie resolves
// to at lookup time. They are the substantive size of a map.
// File size in bytes is an encoding artefact and rides along in
// the entries-chart tooltip. Reviewers asking "how much did this
// map gain or lose?" want this number, not kilobytes of
// compressed trie data.
function entriesCountCard(currentPick, previousPick) {
    const card = createCard("Entries", {
        info: [
            "Each entry maps an IP prefix to the autonomous system that announces it.",
            "Read from the unfilled (source data) variant when published, falling back to the filled variant otherwise.",
            "The vs-previous delta is only shown when both sides come from the same encoding. Filled collapses adjacent same-AS prefixes (~12 %), so a mixed comparison would report that compression as if the map had grown or shrunk. In practice this only blanks the delta on the rare filled-only build whose comparable predecessor is unfilled.",
            "On-disk file size rides along inside the entries-chart tooltip.",
        ],
        source: currentPick.source,
    });
    card.append(
        metricNumber(formatNumber(currentPick.profile.entries_count), {
            key: METRIC_KEY_ENTRIES,
            value: currentPick.profile.entries_count,
        }),
    );
    card.append(metricUnit("prefix \u2192 ASN mappings"));
    if (!previousPick) return card;
    // Skip the delta when the two sides come from different
    // encodings. With ``previous`` now anchored on the last
    // diffable predecessor (which is always unfilled when
    // present), this branch only fires when ``current`` itself is
    // filled-only — comparing filled-encoded entries (compressed)
    // with unfilled-encoded ones (raw) would report the ~12 %
    // fill compression as a phantom shrinkage.
    if (currentPick.source !== previousPick.source) {
        card.append(deltaLine("no comparable previous (encoding mismatch)"));
        return card;
    }
    const delta =
        currentPick.profile.entries_count -
        previousPick.profile.entries_count;
    card.append(deltaLine(`${formatSignedNumber(delta)} vs previous`));
    return card;
}

// Drift-vs-previous reads from the precomputed diff list rather
// than from the per-build profiles, so it inherits the variant
// choice the pipeline made when computing diffs (currently
// unfilled-vs-unfilled, see metrics.py). ``previous`` is the
// most recent diffable predecessor (see previousDiffable() in
// utils/diffs.js), shared with the other two cards so all three
// compare against the same build. Its date sits on the delta
// line as the row's anchor — the other cards say "vs previous"
// without the date so the row does not repeat itself three times.
// When the current build itself is filled-only no source-data
// drift can be computed and the card says so quietly rather than
// printing a misleading dash.
function driftCard(current, previous, diffs) {
    const card = createCard("Drift vs previous", {
        info: [
            "Share of mapping entries that differ between this build and the most recent diffable predecessor.",
            "Computed from unfilled-vs-unfilled diffs to isolate real source-data drift from fill-heuristic shifts.",
            "A 5 % drift means roughly 1 in 20 lookups would now resolve to a different autonomous system.",
        ],
    });
    if (!unfilledProfile(current)) {
        card.append(metricNumber("\u2014"));
        card.append(metricUnit("filled-only build"));
        card.append(deltaLine("Source-data drift needs an unfilled variant."));
        return card;
    }
    if (!previous) {
        card.append(metricNumber("\u2014"));
        card.append(metricUnit("oldest published build"));
        return card;
    }
    const result = pairDriftRatio(diffs, previous.name, current.name);
    if (!result) {
        card.append(metricNumber("\u2014"));
        card.append(metricUnit("no precomputed diff"));
        return card;
    }
    card.append(
        metricNumber(formatPercent(result.ratio, 1), {
            key: METRIC_KEY_DRIFT,
            value: result.ratio,
        }),
    );
    card.append(metricUnit(`${formatNumber(result.total_changes)} entries changed`));
    card.append(deltaLine(`vs ${formatDate(previous.released_at)}`));
    return card;
}

function uniqueAsesCard(currentPick, previousPick) {
    const profile = currentPick.profile;
    const card = createCard("Unique ASes", {
        info: [
            "Number of distinct autonomous systems referenced anywhere in the map.",
            "Filled and unfilled both reference the same ASes (filled adds prefixes, never new ASes), so the number is variant-independent.",
            "The vs-previous delta is taken against the same predecessor as the drift card, so the three cards stay aligned on which build they are comparing against. The drift card spells the predecessor's date out on its delta line.",
            "The bar below shows the share of mapping entries that target IPv4 vs IPv6 prefixes.",
        ],
        source: currentPick.source,
    });
    card.append(
        metricNumber(formatNumber(profile.unique_asns), {
            key: METRIC_KEY_UNIQUE_ASES,
            value: profile.unique_asns,
        }),
    );
    card.append(metricUnit("autonomous systems"));

    // Auxiliary IPv4/IPv6 split sits between the headline and the
    // "vs previous" line, so the delta is always the last node on
    // every overview card. Combined with margin-top:auto on
    // .card__delta this keeps the delta visually flush against the
    // bottom edge regardless of how much extra content the card
    // carries.
    const total = profile.ipv4_count + profile.ipv6_count;
    const ipv4Ratio = total ? profile.ipv4_count / total : 0;
    const ipv6Ratio = total ? profile.ipv6_count / total : 0;
    card.append(splitBar(ipv4Ratio, ipv6Ratio));
    card.append(splitLegend(ipv4Ratio, ipv6Ratio));

    if (previousPick) {
        const delta = profile.unique_asns - previousPick.profile.unique_asns;
        card.append(deltaLine(`${formatSignedNumber(delta)} vs previous`));
    }

    return card;
}

function createCard(label, { info, source } = {}) {
    const card = document.createElement("article");
    card.className = "card";
    if (info) {
        const tip = createInfoTooltip({ body: info, ariaLabel: `About ${label}` });
        tip.classList.add("info-tooltip--card-corner");
        card.append(tip);
    }
    const title = document.createElement("span");
    title.className = "card__label uppercase-label";
    title.textContent = label.toUpperCase();
    card.append(title);
    // Show a small marker only when the card had to fall back to
    // the filled variant. Unfilled is the default and needs no
    // annotation. Tagging every card with "source data" would
    // just be noise.
    if (source === "filled") {
        card.append(fallbackBadge());
    }
    return card;
}

// Subtle annotation for the rare build that only published filled.
// Reads as a status, not as a warning. The numbers are still real,
// they just come from the encoded form rather than from the
// source-data form.
function fallbackBadge() {
    const badge = document.createElement("span");
    badge.className = "card__fallback uppercase-label muted";
    badge.textContent = "Filled fallback";
    badge.title =
        "This build did not publish an unfilled variant. Numbers are read from the filled (embedded) file instead.";
    return badge;
}

function metricNumber(text, meta) {
    const node = document.createElement("p");
    node.className = "card__metric";
    node.textContent = text;
    if (meta && meta.key) {
        node.dataset.metricKey = meta.key;
        if (Number.isFinite(meta.value)) {
            node.dataset.metricValue = String(meta.value);
        }
    }
    return node;
}

function metricUnit(text) {
    const node = document.createElement("p");
    node.className = "card__unit";
    node.textContent = text;
    return node;
}

function deltaLine(text) {
    const node = document.createElement("p");
    node.className = "card__delta";
    node.textContent = text;
    return node;
}

// Two-segment bar: IPv4 in accent, IPv6 in soft violet. Each
// segment is rounded individually so it reads as "two categories"
// rather than a single progress bar that could be misread as "IPv6
// is less / worse than IPv4".
function splitBar(ipv4Ratio, ipv6Ratio) {
    const bar = document.createElement("div");
    bar.className = "split-bar";
    bar.setAttribute("role", "img");
    bar.setAttribute(
        "aria-label",
        `IPv4 ${formatPercent(ipv4Ratio, 0)}, IPv6 ${formatPercent(ipv6Ratio, 0)}`,
    );

    const v4 = document.createElement("div");
    v4.className = "split-bar__segment split-bar__segment--ipv4";
    v4.style.flex = `${ipv4Ratio * 100} 0 0%`;

    const v6 = document.createElement("div");
    v6.className = "split-bar__segment split-bar__segment--ipv6";
    v6.style.flex = `${ipv6Ratio * 100} 0 0%`;

    bar.append(v4, v6);
    return bar;
}

function splitLegend(ipv4Ratio, ipv6Ratio) {
    const legend = document.createElement("div");
    legend.className = "split-legend";
    legend.append(
        legendItem("ipv4", `IPv4 ${formatPercent(ipv4Ratio, 0)}`),
        legendItem("ipv6", `IPv6 ${formatPercent(ipv6Ratio, 0)}`),
    );
    return legend;
}

function legendItem(modifier, label) {
    const item = document.createElement("span");
    item.className = "split-legend__item";

    const dot = document.createElement("span");
    dot.className = `split-legend__dot split-legend__dot--${modifier}`;
    dot.setAttribute("aria-hidden", "true");

    const text = document.createElement("span");
    text.textContent = label;

    item.append(dot, text);
    return item;
}

