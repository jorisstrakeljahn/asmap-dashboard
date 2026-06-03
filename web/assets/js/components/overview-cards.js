// Three overview cards for the Maps tab: entries, unique ASes,
// drift vs previous. All cards prefer the unfilled variant and
// fall back to filled (see utils/map-variants.js), surfacing a
// "filled fallback" badge when the fallback fires.

import {
    formatDate,
    formatNumber,
    formatPercent,
    formatSignedNumber,
} from "../format.js";
import {
    DRIFT_IPV4_COVERAGE,
    DRIFT_IPV6_COVERAGE,
    pairDriftRatio,
} from "../utils/diffs.js";
import { mutedNote } from "../utils/dom.js";
import { t } from "../utils/i18n.js";
import {
    pickPreferUnfilled,
    unfilledProfile,
} from "../utils/map-variants.js";
import { createInfoTooltip } from "./info-tooltip.js";

// ``previous`` bridges across filled-only builds so all three
// cards anchor their "vs previous" delta on the same predecessor.
// The drift card spells that date out on its delta line.
export function mount(parent, { current, previous, diffs }) {
    if (!current) {
        parent.replaceChildren(mutedNote(t("overview.noPublishedMaps")));
        return;
    }
    const currentPick = pickPreferUnfilled(current);
    if (!currentPick) {
        parent.replaceChildren(
            mutedNote(t("overview.noVariantData", { name: current.name })),
        );
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

function entriesCountCard(currentPick, previousPick) {
    const card = createCard(t("overview.entries.label"), {
        info: t("overview.entries.info"),
        infoAria: t("overview.entries.infoAria"),
        source: currentPick.source,
    });
    card.append(
        metricNumber(formatNumber(currentPick.profile.entries_count)),
    );
    card.append(metricUnit(t("overview.entries.unit")));
    if (!previousPick) return card;
    // Encoding-mismatch guard. Comparing filled (compressed) and
    // unfilled (raw) entry counts would report the ~12 % fill
    // compression as phantom shrinkage.
    if (currentPick.source !== previousPick.source) {
        card.append(deltaLine(t("overview.entries.encodingMismatch")));
        return card;
    }
    const delta =
        currentPick.profile.entries_count -
        previousPick.profile.entries_count;
    card.append(
        deltaLine(
            t("overview.entries.deltaVsPrevious", {
                delta: formatSignedNumber(delta),
            }),
        ),
    );
    return card;
}

// Reads from the precomputed diff list (unfilled-vs-unfilled —
// see metrics.py) so it inherits the variant choice made when
// the diffs were materialised. ``previous`` is the row's shared
// anchor; the date prints here so the other two cards can stay
// at "vs previous".
//
// The headline number is IPv4 coverage drift — the share of
// IPv4 addresses whose ASN changed between the two builds. IPv4
// is the dominant family for Bitcoin Core peer reachability, so
// surfacing it as the headline answers the operational question
// "how much of the routable IPv4 space has shifted ASN?" rather
// than "how many trie leaves moved?", which would let IPv6
// noise drown out real BGP shifts. IPv6 coverage rides along as
// a secondary line because the two families have independent
// peer-diversity meaning, but the trie-leaf "entries" reading is
// deliberately not surfaced any more (it was the exact failure
// mode the coverage view replaces).
function driftCard(current, previous, diffs) {
    const card = createCard(t("overview.drift.label"), {
        info: t("overview.drift.info"),
        infoAria: t("overview.drift.infoAria"),
    });
    if (!unfilledProfile(current)) {
        card.append(metricNumber("\u2014"));
        card.append(metricUnit(t("overview.drift.filledOnly")));
        card.append(deltaLine(t("overview.drift.filledOnlyHint")));
        return card;
    }
    if (!previous) {
        card.append(metricNumber("\u2014"));
        card.append(metricUnit(t("overview.drift.oldestBuild")));
        return card;
    }
    const views = pairDriftRatio(diffs, previous.name, current.name);
    if (!views) {
        card.append(metricNumber("\u2014"));
        card.append(metricUnit(t("overview.drift.noPrecomputed")));
        return card;
    }
    const headline = views[DRIFT_IPV4_COVERAGE];
    card.append(metricNumber(formatPercent(headline.ratio, 1)));
    card.append(
        metricUnit(
            t("overview.drift.ipv4Changed", {
                count: formatNumber(headline.changed),
            }),
        ),
    );
    card.append(
        deltaLine(
            t("overview.drift.secondaryViews", {
                ipv6: formatPercent(views[DRIFT_IPV6_COVERAGE].ratio, 1),
            }),
        ),
    );
    card.append(
        deltaLine(
            t("overview.drift.vsDate", { date: formatDate(previous.released_at) }),
        ),
    );
    return card;
}

function uniqueAsesCard(currentPick, previousPick) {
    const profile = currentPick.profile;
    const card = createCard(t("overview.uniqueAses.label"), {
        info: t("overview.uniqueAses.info"),
        infoAria: t("overview.uniqueAses.infoAria"),
        source: currentPick.source,
    });
    card.append(metricNumber(formatNumber(profile.unique_asns)));
    card.append(metricUnit(t("overview.uniqueAses.unit")));

    const total = profile.ipv4_count + profile.ipv6_count;
    const ipv4Ratio = total ? profile.ipv4_count / total : 0;
    const ipv6Ratio = total ? profile.ipv6_count / total : 0;
    card.append(splitBar(ipv4Ratio, ipv6Ratio));
    card.append(splitLegend(ipv4Ratio, ipv6Ratio));

    if (previousPick) {
        const delta = profile.unique_asns - previousPick.profile.unique_asns;
        card.append(
            deltaLine(
                t("overview.uniqueAses.deltaVsPrevious", {
                    delta: formatSignedNumber(delta),
                }),
            ),
        );
    }

    return card;
}

function createCard(label, { info, infoAria, source } = {}) {
    const card = document.createElement("article");
    card.className = "card";
    if (info) {
        const tip = createInfoTooltip({ body: info, ariaLabel: infoAria });
        tip.classList.add("info-tooltip--card-corner");
        card.append(tip);
    }
    const title = document.createElement("span");
    title.className = "card__label uppercase-label";
    title.textContent = label.toUpperCase();
    card.append(title);
    if (source === "filled") {
        card.append(fallbackBadge());
    }
    return card;
}

function fallbackBadge() {
    const badge = document.createElement("span");
    badge.className = "card__fallback uppercase-label muted";
    badge.textContent = t("overview.fallbackBadge.label");
    badge.title = t("overview.fallbackBadge.tooltip");
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

// Each segment is rounded individually so the bar reads as
// "two categories", not a single progress meter.
function splitBar(ipv4Ratio, ipv6Ratio) {
    const bar = document.createElement("div");
    bar.className = "split-bar";
    bar.setAttribute("role", "img");
    bar.setAttribute(
        "aria-label",
        t("overview.uniqueAses.splitAria", {
            pct4: formatPercent(ipv4Ratio, 0),
            pct6: formatPercent(ipv6Ratio, 0),
        }),
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
        legendItem(
            "ipv4",
            t("overview.uniqueAses.ipv4Legend", { pct: formatPercent(ipv4Ratio, 0) }),
        ),
        legendItem(
            "ipv6",
            t("overview.uniqueAses.ipv6Legend", { pct: formatPercent(ipv6Ratio, 0) }),
        ),
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
