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
import {
    createCard,
    deltaLine,
    metaLine,
    metricNumber,
    metricUnit,
} from "./metric-card.js";

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
        badge: currentPick.source === "filled" ? fallbackBadge() : null,
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
        card.append(metaLine(t("overview.entries.encodingMismatch")));
        return card;
    }
    const delta =
        currentPick.profile.entries_count -
        previousPick.profile.entries_count;
    card.append(
        metaLine(
            t("overview.entries.deltaVsPrevious", {
                delta: formatSignedNumber(delta),
            }),
        ),
    );
    return card;
}

// Reads the precomputed diff list (unfilled-vs-unfilled — see
// metrics.py), inheriting the variant choice from when the diffs
// were materialised. ``previous`` is the row's shared anchor; the
// date prints here so the other two cards stay at "vs previous".
//
// Headline is IPv4 coverage drift — the share of IPv4 addresses
// whose ASN changed. IPv4 dominates Bitcoin Core peer reachability,
// so it answers "how much routable IPv4 space shifted ASN?" rather
// than "how many trie leaves moved?" (which let IPv6 noise drown
// out real BGP shifts). IPv6 rides along as a secondary line; the
// trie-leaf "entries" reading is deliberately dropped.
function driftCard(current, previous, diffs) {
    const card = createCard(t("overview.drift.label"), {
        info: t("overview.drift.info"),
        infoAria: t("overview.drift.infoAria"),
    });
    if (!unfilledProfile(current)) {
        card.append(metricNumber("\u2014"));
        card.append(metricUnit(t("overview.drift.filledOnly")));
        card.append(metaLine(t("overview.drift.filledOnlyHint")));
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
        metaLine(
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
        badge: currentPick.source === "filled" ? fallbackBadge() : null,
    });
    card.append(metricNumber(formatNumber(profile.unique_asns)));
    card.append(metricUnit(t("overview.uniqueAses.unit")));

    const total = profile.ipv4_count + profile.ipv6_count;
    const ipv4Ratio = total ? profile.ipv4_count / total : 0;
    const ipv6Ratio = total ? profile.ipv6_count / total : 0;
    // Legend (the percentages) first as the card's data line, then the
    // bar as its visual underline; the "vs previous" line pins to the
    // bottom like the other cards.
    card.append(splitLegend(ipv4Ratio, ipv6Ratio));
    card.append(splitBar(ipv4Ratio, ipv6Ratio));

    if (previousPick) {
        const delta = profile.unique_asns - previousPick.profile.unique_asns;
        card.append(
            metaLine(
                t("overview.uniqueAses.deltaVsPrevious", {
                    delta: formatSignedNumber(delta),
                }),
            ),
        );
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
