// Three overview cards for the Maps tab: entries, unique ASes,
// drift vs previous. All cards prefer the unfilled variant and
// fall back to filled (see utils/map-variants.js), surfacing a
// "filled fallback" badge when the fallback fires.

import { html, nothing } from "../vendor/lit-html.js";
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
import { mutedNote, renderInto } from "../utils/dom.js";
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
        renderInto(mutedNote(t("overview.noPublishedMaps")), parent);
        return;
    }
    const currentPick = pickPreferUnfilled(current);
    if (!currentPick) {
        renderInto(mutedNote(t("overview.noVariantData", { name: current.name })), parent);
        return;
    }

    const previousPick = pickPreferUnfilled(previous);
    renderInto(
        html`
            <div class="card-row">
                ${entriesCountCard(currentPick, previousPick)}
                ${uniqueAsesCard(currentPick, previousPick)}
                ${driftCard(current, previous, diffs)}
            </div>
        `,
        parent,
    );
}

function entriesCountCard(currentPick, previousPick) {
    return createCard(
        t("overview.entries.label"),
        html`
            ${metricNumber(formatNumber(currentPick.profile.entries_count))}
            ${metricUnit(t("overview.entries.unit"))}
            ${entriesMetaLine(currentPick, previousPick)}
        `,
        {
            info: t("overview.entries.info"),
            infoAria: t("overview.entries.infoAria"),
            badge: currentPick.source === "filled" ? fallbackBadge() : null,
        },
    );
}

function entriesMetaLine(currentPick, previousPick) {
    if (!previousPick) return nothing;
    // Encoding-mismatch guard. Comparing filled (compressed) and
    // unfilled (raw) entry counts would report the ~12 % fill
    // compression as phantom shrinkage.
    if (currentPick.source !== previousPick.source) {
        return metaLine(t("overview.entries.encodingMismatch"));
    }
    const delta =
        currentPick.profile.entries_count - previousPick.profile.entries_count;
    return metaLine(
        t("overview.entries.deltaVsPrevious", {
            delta: formatSignedNumber(delta),
        }),
    );
}

// Reads the precomputed unfilled-vs-unfilled diff list (see metrics.py).
// `previous` is the row's shared anchor; the date prints here so the other two
// cards stay at "vs previous". Headline is IPv4 coverage drift - the share of
// IPv4 address space whose ASN changed; IPv4 dominates Core peer reachability,
// so it beats a trie-leaf count where IPv6 noise drowns real BGP shifts. IPv6
// rides along secondary; the trie-leaf "entries" reading is dropped.
function driftCard(current, previous, diffs) {
    return createCard(t("overview.drift.label"), driftBody(current, previous, diffs), {
        info: t("overview.drift.info"),
        infoAria: t("overview.drift.infoAria"),
    });
}

function driftBody(current, previous, diffs) {
    if (!unfilledProfile(current)) {
        return html`
            ${metricNumber("\u2014")}
            ${metricUnit(t("overview.drift.filledOnly"))}
            ${metaLine(t("overview.drift.filledOnlyHint"))}
        `;
    }
    if (!previous) {
        return html`
            ${metricNumber("\u2014")}
            ${metricUnit(t("overview.drift.oldestBuild"))}
        `;
    }
    const views = pairDriftRatio(diffs, previous.name, current.name);
    if (!views) {
        return html`
            ${metricNumber("\u2014")}
            ${metricUnit(t("overview.drift.noPrecomputed"))}
        `;
    }
    const headline = views[DRIFT_IPV4_COVERAGE];
    return html`
        ${metricNumber(formatPercent(headline.ratio, 1))}
        ${metricUnit(
            t("overview.drift.ipv4Changed", {
                count: formatNumber(headline.changed),
            }),
        )}
        ${deltaLine(
            t("overview.drift.secondaryViews", {
                ipv6: formatPercent(views[DRIFT_IPV6_COVERAGE].ratio, 1),
            }),
        )}
        ${metaLine(
            t("overview.drift.vsDate", { date: formatDate(previous.released_at) }),
        )}
    `;
}

function uniqueAsesCard(currentPick, previousPick) {
    const profile = currentPick.profile;
    const total = profile.ipv4_count + profile.ipv6_count;
    const ipv4Ratio = total ? profile.ipv4_count / total : 0;
    const ipv6Ratio = total ? profile.ipv6_count / total : 0;
    const meta = previousPick
        ? metaLine(
              t("overview.uniqueAses.deltaVsPrevious", {
                  delta: formatSignedNumber(
                      profile.unique_asns - previousPick.profile.unique_asns,
                  ),
              }),
          )
        : nothing;

    // Legend (the percentages) first as the card's data line, then the
    // bar as its visual underline; the "vs previous" line pins to the
    // bottom like the other cards.
    return createCard(
        t("overview.uniqueAses.label"),
        html`
            ${metricNumber(formatNumber(profile.unique_asns))}
            ${metricUnit(t("overview.uniqueAses.unit"))}
            ${splitLegend(ipv4Ratio, ipv6Ratio)}
            ${splitBar(ipv4Ratio, ipv6Ratio)}
            ${meta}
        `,
        {
            info: t("overview.uniqueAses.info"),
            infoAria: t("overview.uniqueAses.infoAria"),
            badge: currentPick.source === "filled" ? fallbackBadge() : null,
        },
    );
}

function fallbackBadge() {
    return html`<span
        class="card__fallback uppercase-label muted"
        title=${t("overview.fallbackBadge.tooltip")}
    >${t("overview.fallbackBadge.label")}</span>`;
}

// Each segment is rounded individually so the bar reads as
// "two categories", not a single progress meter.
function splitBar(ipv4Ratio, ipv6Ratio) {
    return html`
        <div
            class="split-bar"
            role="img"
            aria-label=${t("overview.uniqueAses.splitAria", {
                pct4: formatPercent(ipv4Ratio, 0),
                pct6: formatPercent(ipv6Ratio, 0),
            })}
        >
            <div
                class="split-bar__segment split-bar__segment--ipv4"
                style="flex: ${ipv4Ratio * 100} 0 0%"
            ></div>
            <div
                class="split-bar__segment split-bar__segment--ipv6"
                style="flex: ${ipv6Ratio * 100} 0 0%"
            ></div>
        </div>
    `;
}

function splitLegend(ipv4Ratio, ipv6Ratio) {
    return html`
        <div class="split-legend">
            ${legendItem(
                "ipv4",
                t("overview.uniqueAses.ipv4Legend", {
                    pct: formatPercent(ipv4Ratio, 0),
                }),
            )}
            ${legendItem(
                "ipv6",
                t("overview.uniqueAses.ipv6Legend", {
                    pct: formatPercent(ipv6Ratio, 0),
                }),
            )}
        </div>
    `;
}

function legendItem(modifier, label) {
    return html`<span class="split-legend__item"
        ><span
            class="split-legend__dot split-legend__dot--${modifier}"
            aria-hidden="true"
        ></span><span>${label}</span></span
    >`;
}
