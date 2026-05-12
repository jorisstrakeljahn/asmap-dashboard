import {
    daysBetween,
    formatNumber,
    formatPercent,
    formatSignedNumber,
    formatSignedPercent,
} from "../format.js";

// Pure render: build the three overview cards for ``current`` and the
// chronologically preceding build ``previous`` (may be null for the
// oldest map). The caller decides which map is current; this module
// only knows how to draw cards from the pair, so it can be re-invoked
// on every selector change without owning any state.
export function mount(parent, current, previous) {
    if (!current) {
        parent.replaceChildren(emptyState());
        return;
    }
    const row = document.createElement("div");
    row.className = "card-row";
    row.append(
        mapSizeCard(current, previous),
        uniqueAsesCard(current, previous),
        stalenessCard(current),
    );
    parent.replaceChildren(row);
}

function mapSizeCard(current, previous) {
    const card = createCard("Map Size");
    card.append(metricNumber(formatNumber(current.file_size_bytes)));
    card.append(metricUnit("bytes"));
    if (previous) {
        const ratio =
            (current.file_size_bytes - previous.file_size_bytes) /
            previous.file_size_bytes;
        card.append(deltaLine(`${formatSignedPercent(ratio)} vs previous`));
    }
    return card;
}

function uniqueAsesCard(current, previous) {
    const card = createCard("Unique ASes");
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

function stalenessCard(current) {
    const card = createCard("Staleness");
    const days = daysBetween(current.released_at);
    card.append(metricNumber(`${formatNumber(days)} days`));
    card.append(metricUnit("since this build"));
    return card;
}

function createCard(label) {
    const card = document.createElement("article");
    card.className = "card";
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
