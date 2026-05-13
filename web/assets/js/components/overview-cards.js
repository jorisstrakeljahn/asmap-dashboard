// Overview row at the top of the Maps tab: three cards giving a
// snapshot of the selected build - how many mappings it carries,
// how many unique ASes those mappings cover (with IPv4 / IPv6
// split), and how far it drifted from the previous build. Each
// card carries a "vs previous" delta when a chronologically
// preceding build is available. Build age sits inline on the
// section toolbar; raw file size lives in the History charts.

import {
    formatNumber,
    formatPercent,
    formatSignedNumber,
} from "../format.js";
import { pairDriftRatio } from "../utils/diffs.js";
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
    const row = document.createElement("div");
    row.className = "card-row";
    row.append(
        entriesCountCard(current, previous),
        uniqueAsesCard(current, previous),
        driftCard(current, previous, diffs),
    );
    parent.replaceChildren(row);
}

// Entries are the (prefix, ASN) tuples the binary trie resolves to
// at lookup time - the substantive size of a map. File size in
// bytes is an encoding artefact and lives in the History charts;
// reviewers asking "how much did this map gain or lose?" want this
// number, not kilobytes of compressed trie data.
function entriesCountCard(current, previous) {
    const card = createCard("Entries", {
        info: [
            "Each entry maps an IP prefix to the autonomous system that announces it.",
            "This is the substantive size of the map. The on-disk file size is an encoding artefact and lives in the History charts.",
        ],
    });
    card.append(metricNumber(formatNumber(current.entries_count)));
    card.append(metricUnit("prefix \u2192 ASN mappings"));
    if (previous) {
        const delta = current.entries_count - previous.entries_count;
        card.append(deltaLine(`${formatSignedNumber(delta)} vs previous`));
    }
    return card;
}

// Drift-vs-previous: how much of the trie shifted since the last
// build, expressed both as a share (headline) and as the absolute
// number of changed entries (subtitle). This is the same number the
// drift chart plots over time; the card is the snapshot for the
// currently selected build so the reader can answer "did this
// release change a lot?" without scrolling to the chart. Falls
// back to a quiet placeholder for the oldest build (no predecessor
// to diff against).
function driftCard(current, previous, diffs) {
    const card = createCard("Drift vs previous", {
        info: [
            "Share of mapping entries that differ between this build and the chronologically previous one.",
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

function uniqueAsesCard(current, previous) {
    const card = createCard("Unique ASes", {
        info: [
            "Number of distinct autonomous systems referenced anywhere in the map.",
            "The bar below shows the share of mapping entries, not ASes, that target IPv4 vs IPv6 prefixes.",
        ],
    });
    card.append(metricNumber(formatNumber(current.unique_asns)));
    card.append(metricUnit("autonomous systems"));

    // Auxiliary IPv4/IPv6 split sits between the headline and the
    // "vs previous" line, so the delta is always the last node on
    // every overview card. Combined with margin-top:auto on
    // .card__delta this keeps the delta visually flush against the
    // bottom edge regardless of how much extra content the card
    // carries.
    const total = current.ipv4_count + current.ipv6_count;
    const ipv4Ratio = total ? current.ipv4_count / total : 0;
    const ipv6Ratio = total ? current.ipv6_count / total : 0;
    card.append(splitBar(ipv4Ratio, ipv6Ratio));
    card.append(splitLegend(ipv4Ratio, ipv6Ratio));

    if (previous) {
        const delta = current.unique_asns - previous.unique_asns;
        card.append(deltaLine(`${formatSignedNumber(delta)} vs previous`));
    }

    return card;
}

function createCard(label, { info } = {}) {
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
    return card;
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
