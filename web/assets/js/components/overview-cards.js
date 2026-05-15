// Overview row at the top of the Maps tab: three cards giving a
// snapshot of the selected build - how many mappings it carries,
// how many unique ASes those mappings cover (with IPv4 / IPv6
// split), and how far it drifted from the previous build. Each
// card carries a "vs previous" delta when a chronologically
// preceding build is available. Build age sits inline on the
// section toolbar; raw file size lives in the History charts.
//
// All cards read the unfilled variant by default and fall back to
// filled when unfilled was not published for a build (see
// utils/variants.js for the rule). When the fallback fires, a small
// "filled fallback" badge appears on the card so the reader knows
// the number is not from source data.

import {
    formatNumber,
    formatPercent,
    formatSignedNumber,
} from "../format.js";
import { pairDriftRatio } from "../utils/diffs.js";
import { pickPreferUnfilled } from "../utils/variants.js";
import { createInfoTooltip } from "./info-tooltip.js";

// Pure render: build the overview cards for ``current`` and the
// chronologically preceding build ``previous`` (may be null for the
// oldest map). ``diffs`` is the pair-diff array from metrics.json,
// used by the drift card; the other cards never need it.
export function mount(parent, current, previous, diffs) {
    if (!current) {
        parent.replaceChildren(emptyState());
        return;
    }
    const currentPick = pickPreferUnfilled(current);
    if (!currentPick) {
        parent.replaceChildren(missingVariantsState(current));
        return;
    }
    const previousPick = pickPreferUnfilled(previous);
    const row = document.createElement("div");
    row.className = "card-row";
    row.append(
        entriesCountCard(currentPick, previousPick),
        uniqueAsesCard(currentPick, previousPick),
        driftCard(current, previous, diffs),
    );
    parent.replaceChildren(row);
}

// Entries are the (prefix, ASN) tuples the binary trie resolves to
// at lookup time - the substantive size of a map. File size in
// bytes is an encoding artefact and lives in the History charts;
// reviewers asking "how much did this map gain or lose?" want this
// number, not kilobytes of compressed trie data.
function entriesCountCard(currentPick, previousPick) {
    const card = createCard("Entries", {
        info: [
            "Each entry maps an IP prefix to the autonomous system that announces it.",
            "Read from the unfilled (source data) variant when published, falling back to the filled variant otherwise.",
            "On-disk file size is an encoding artefact and lives in the History charts.",
        ],
        source: currentPick.source,
    });
    card.append(metricNumber(formatNumber(currentPick.profile.entries_count)));
    card.append(metricUnit("prefix \u2192 ASN mappings"));
    if (previousPick) {
        const delta =
            currentPick.profile.entries_count -
            previousPick.profile.entries_count;
        card.append(deltaLine(`${formatSignedNumber(delta)} vs previous`));
    }
    return card;
}

// Drift-vs-previous reads from the precomputed diff list rather
// than from the per-build profiles, so it inherits the variant
// choice the pipeline made when computing diffs (currently
// unfilled-vs-unfilled, see metrics.py). When the previous or
// current build has no unfilled variant the precomputed diff is
// missing and the card shows a quiet placeholder instead of an
// unfounded number.
function driftCard(current, previous, diffs) {
    const card = createCard("Drift vs previous", {
        info: [
            "Share of mapping entries that differ between this build and the chronologically previous one.",
            "Computed from unfilled-vs-unfilled diffs to isolate real source-data drift from fill-heuristic shifts.",
            "A 5 % drift means roughly 1 in 20 lookups would now resolve to a different autonomous system.",
        ],
    });
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
    card.append(metricNumber(formatPercent(result.ratio, 1)));
    card.append(metricUnit(`${formatNumber(result.total_changes)} entries changed`));
    return card;
}

function uniqueAsesCard(currentPick, previousPick) {
    const profile = currentPick.profile;
    const card = createCard("Unique ASes", {
        info: [
            "Number of distinct autonomous systems referenced anywhere in the map.",
            "Filled and unfilled both reference the same ASes (filled adds prefixes, never new ASes), so the number is variant-independent.",
            "The bar below shows the share of mapping entries that target IPv4 vs IPv6 prefixes.",
        ],
        source: currentPick.source,
    });
    card.append(metricNumber(formatNumber(profile.unique_asns)));
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
    // annotation; muddying every card with "source data" would just
    // be noise.
    if (source === "filled") {
        card.append(fallbackBadge());
    }
    return card;
}

// Subtle annotation for the rare build that only published filled.
// Reads as a status, not as a warning - we are still showing real
// numbers, they just come from the encoded form rather than from
// the source-data form.
function fallbackBadge() {
    const badge = document.createElement("span");
    badge.className = "card__fallback uppercase-label muted";
    badge.textContent = "Filled fallback";
    badge.title =
        "This build did not publish an unfilled variant. Numbers are read from the filled (embedded) file instead.";
    return badge;
}

function metricNumber(text) {
    const node = document.createElement("p");
    node.className = "card__metric";
    node.textContent = text;
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

function emptyState() {
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = "No published maps found in metrics.json.";
    return note;
}

// Defensive: a build entry exists but neither variant is marked
// present. Should never happen in practice (discover_maps would
// not have surfaced the build), but the frontend stays honest by
// telling the reader instead of rendering hollow cards.
function missingVariantsState(build) {
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = `Build ${build.name} has no published variant data.`;
    return note;
}
