import {
    daysBetween,
    formatNumber,
    formatPercent,
    formatSignedNumber,
    formatSignedPercent,
} from "../format.js";

export function mount(parent, maps) {
    if (!maps.length) {
        parent.replaceChildren(emptyState());
        return;
    }
    const latest = maps[maps.length - 1];
    const previous = maps.length > 1 ? maps[maps.length - 2] : null;

    const row = document.createElement("div");
    row.className = "card-row";
    row.append(
        mapSizeCard(latest, previous),
        uniqueAsesCard(latest, previous),
        stalenessCard(latest),
    );
    parent.replaceChildren(row);
}

function mapSizeCard(latest, previous) {
    const card = createCard("Map Size");
    card.append(metricNumber(formatNumber(latest.file_size_bytes)));
    card.append(metricUnit("bytes"));
    if (previous) {
        const ratio =
            (latest.file_size_bytes - previous.file_size_bytes) /
            previous.file_size_bytes;
        card.append(deltaLine(`${formatSignedPercent(ratio)} vs previous`));
    }
    return card;
}

function uniqueAsesCard(latest, previous) {
    const card = createCard("Unique ASes");
    card.append(metricNumber(formatNumber(latest.unique_asns)));
    card.append(metricUnit("autonomous systems"));
    if (previous) {
        const delta = latest.unique_asns - previous.unique_asns;
        card.append(deltaLine(`${formatSignedNumber(delta)} vs previous`));
    }

    const total = latest.ipv4_count + latest.ipv6_count;
    const ipv4Ratio = total ? latest.ipv4_count / total : 0;
    const ipv6Ratio = total ? latest.ipv6_count / total : 0;
    card.append(splitBar(ipv4Ratio));
    card.append(splitLegend(ipv4Ratio, ipv6Ratio));

    return card;
}

function stalenessCard(latest) {
    const card = createCard("Staleness");
    const days = daysBetween(latest.released_at);
    card.append(metricNumber(`${formatNumber(days)} days`));
    card.append(metricUnit("since latest build"));
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

function splitBar(ipv4Ratio) {
    const track = document.createElement("div");
    track.className = "split-bar";
    const fill = document.createElement("div");
    fill.className = "split-bar__fill";
    fill.style.width = `${ipv4Ratio * 100}%`;
    track.append(fill);
    return track;
}

function splitLegend(ipv4Ratio, ipv6Ratio) {
    const legend = document.createElement("div");
    legend.className = "split-legend";
    legend.innerHTML = `
        <span>IPv4 ${formatPercent(ipv4Ratio, 0)}</span>
        <span>IPv6 ${formatPercent(ipv6Ratio, 0)}</span>
    `;
    return legend;
}

function emptyState() {
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = "No published maps found in metrics.json.";
    return note;
}
