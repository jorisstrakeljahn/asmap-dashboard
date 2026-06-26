// Network tab hero: up to six snapshot cards on the most recent crawl of the
// primary source, scored against the build in effect then. Mirrors the Maps
// overview layout so the tabs feel of a piece.
//
// Two cards per row, paired so the grid reads as three themes:
//   Row 1 - diversity / adversary: AS concentration (HHI now), ASes to reach
//           50% (the 50%-control headcount).
//   Row 2 - map freshness / churn: map staleness (drift of a ~1-year-old map),
//           latest update impact (optional, only when network.json carries it).
//   Row 3 - raw context: reachable nodes (IPv4/IPv6 split), peer-diversity
//           buckets (ASmap vs Core defaults).
//
// ASmap coverage has no card: it idles at ~99.9% and reads as noise; its story
// lives in the coverage trend chart.

import { html, nothing, render } from "../../vendor/lit-html.js";
import { formatNumber, formatPercent } from "../../format.js";
import { mutedNote } from "../../utils/dom.js";
import { t } from "../../utils/i18n.js";
import {
    createCard,
    deltaLine,
    metricNumber,
    metricUnit,
} from "../metric-card.js";

const TARGET_STALENESS_DAYS = 365;

export function mount(parent, { snapshot, decay, latestUpdate, asOf }) {
    if (!parent) return;
    if (!snapshot) {
        render(mutedNote(t("network.overview.empty")), parent);
        return;
    }
    // The optional latest-update card slots into row 2 next to staleness (both
    // speak to map freshness); without it, nodes/buckets reflow up so the
    // pairing degrades without a hole. Normally present (every source ships
    // latest_update); drops only when fewer than two builds are diffable.
    const cards = [
        concentrationCard(snapshot),
        reach50Card(snapshot),
        stalenessCard(decay),
    ];
    if (latestUpdate) cards.push(latestUpdateCard(latestUpdate));
    cards.push(nodesCard(snapshot), bucketsCard(snapshot));

    // A muted caption above the card row names the crawl and its snapshot date:
    // the source switch lives in the section header, so the date sits where the
    // numbers are and updates with the switch.
    render(
        html`
            ${asOf
                ? html`<p class="network-overview__meta muted">${asOf}</p>`
                : nothing}
            <div class="card-row">${cards}</div>
        `,
        parent,
    );
}

// Just the headline count; source/date is stated once at the section level. The
// IPv4/IPv6 split bar was dropped - it collided with the Maps tab's prefix-
// family bar (~80/20 in both) while measuring a different population.
function nodesCard(snapshot) {
    return createCard(
        t("network.overview.nodes.label"),
        html`
            ${metricNumber(formatNumber(snapshot.nodes_clearnet))}
            ${metricUnit(t("network.overview.nodes.unit"))}
            ${deltaLine(familySplitLine(snapshot, (f) => f.nodes ?? 0, formatNumber))}
        `,
        {
            info: t("network.overview.nodes.info"),
            infoAria: t("network.overview.nodes.infoAria"),
        },
    );
}

// Adversarial reading: the fewest operators an attacker must control to sit
// next to half the mapped listening nodes (higher is healthier). 50% is the
// standard decentralisation-study cut, so it's comparable across them; studies
// call this the AS Nakamoto coefficient.
function reach50Card(snapshot) {
    const body =
        snapshot.ases_to_50pct == null
            ? html`
                  ${metricNumber("\u2014")}
                  ${metricUnit(t("network.overview.reach50.noData"))}
              `
            : html`
                  ${metricNumber(formatNumber(snapshot.ases_to_50pct))}
                  ${metricUnit(t("network.overview.reach50.unit"))}
                  ${deltaLine(
                      t("network.overview.reach50.basis", {
                          mapped: formatNumber(snapshot.mapped),
                      }),
                  )}
              `;
    return createCard(t("network.overview.reach50.label"), body, {
        info: t("network.overview.reach50.info"),
        infoAria: t("network.overview.reach50.infoAria"),
    });
}

// Per-family context line shared by cards with a family split.
// ``pick`` reads the value off one family slice, ``format`` renders it.
function familySplitLine(snapshot, pick, format) {
    const families = snapshot.families ?? {};
    return t("network.overview.familySplit", {
        ipv4: format(pick(families.ipv4 ?? {})),
        ipv6: format(pick(families.ipv6 ?? {})),
    });
}

// Leads with HHI, not the largest operator's share: that share can fall while
// concentration shifts to the #2 operator, so HHI (summed over the whole AS
// distribution) is the honest headline. What HHI is lives in the info tooltip.
function concentrationCard(snapshot) {
    return createCard(
        t("network.overview.concentration.label"),
        html`
            ${metricNumber(snapshot.hhi.toFixed(3))}
            ${metricUnit(t("network.overview.concentration.unit"))}
            ${deltaLine(
                familySplitLine(snapshot, (f) => f.hhi ?? 0, (v) => v.toFixed(3)),
            )}
        `,
        {
            info: t("network.overview.concentration.info"),
            infoAria: t("network.overview.concentration.infoAria"),
        },
    );
}

function bucketsCard(snapshot) {
    const bucketing = snapshot.bucketing;
    return createCard(
        t("network.overview.buckets.label"),
        html`
            ${metricNumber(formatNumber(bucketing.asmap_groups))}
            ${metricUnit(t("network.overview.buckets.unit"))}
            ${deltaLine(
                t("network.overview.buckets.vsDefault", {
                    count: formatNumber(bucketing.default_groups),
                    ratio: bucketing.reduction_ratio.toFixed(1),
                }),
            )}
        `,
        {
            info: t("network.overview.buckets.info"),
            infoAria: t("network.overview.buckets.infoAria"),
        },
    );
}

// How many observed nodes changed AS when the most recent map shipped vs the
// build before it - the Diff Explorer numbers on the real node set. Headline is
// the count moved; the line below splits it into the same three buckets.
function latestUpdateCard(latestUpdate) {
    return createCard(
        t("network.overview.latestUpdate.label"),
        html`
            ${metricNumber(formatNumber(latestUpdate.total_affected))}
            ${metricUnit(t("network.overview.latestUpdate.unit"))}
            ${deltaLine(
                t("network.overview.latestUpdate.basis", {
                    reassigned: formatNumber(latestUpdate.reassigned),
                    newlyMapped: formatNumber(latestUpdate.newly_mapped),
                    unmapped: formatNumber(latestUpdate.unmapped),
                }),
            )}
        `,
        {
            info: t("network.overview.latestUpdate.info"),
            infoAria: t("network.overview.latestUpdate.infoAria"),
        },
    );
}

// Reads the decay curve at exactly one year of map age: how much of today's
// node set a map that old would mislocate. A one-year figure (not raw drift at
// the nearest build) since builds aren't 365 days apart and "X% in 398 days"
// reads as arbitrary. The context line names the curve points it rests on.
function stalenessCard(decay) {
    const reading = stalenessAtTarget(decay);
    const body = !reading
        ? html`
              ${metricNumber("\u2014")}
              ${metricUnit(t("network.overview.staleness.noData"))}
          `
        : html`
              ${metricNumber(formatPercent(reading.value / 100, 1))}
              ${metricUnit(t("network.overview.staleness.unit"))}
              ${deltaLine(stalenessBasis(reading))}
          `;
    return createCard(t("network.overview.staleness.label"), body, {
        info: t("network.overview.staleness.info"),
        infoAria: t("network.overview.staleness.infoAria"),
    });
}

// Reads the curve at TARGET_STALENESS_DAYS. Three cases: two points bracket the
// mark -> interpolate linearly (stays on the measured curve); a point sits on
// it -> take as is; one-sided history -> scale the nearest point by 365/age (a
// linear extrapolation through the origin). The decay curve saturates, so the
// extrapolation over-estimates from a younger anchor, under-estimates from an
// older one, and amplifies that point's noise by 365/age - hence the separate
// basis label. Live data brackets the mark, so case 1 applies.
function stalenessAtTarget(decay) {
    const points = (decay?.points ?? [])
        .filter((p) => p.age_days > 0)
        .sort((a, b) => a.age_days - b.age_days);
    if (points.length === 0) return null;
    let lower = null;
    let upper = null;
    for (const point of points) {
        if (point.age_days <= TARGET_STALENESS_DAYS) lower = point;
        if (point.age_days >= TARGET_STALENESS_DAYS) {
            upper = point;
            break;
        }
    }
    if (lower && upper) {
        const span = upper.age_days - lower.age_days;
        if (span === 0) {
            // A build exactly one year old - read it directly.
            return { interpolated: false, value: lower.drift_pct, point: lower };
        }
        const fraction = (TARGET_STALENESS_DAYS - lower.age_days) / span;
        return {
            interpolated: true,
            value: lower.drift_pct + fraction * (upper.drift_pct - lower.drift_pct),
            lower,
            upper,
        };
    }
    const nearest = lower ?? upper;
    return {
        interpolated: false,
        value: (nearest.drift_pct * TARGET_STALENESS_DAYS) / nearest.age_days,
        point: nearest,
    };
}

function stalenessBasis(reading) {
    if (reading.interpolated) {
        return t("network.overview.staleness.basisInterpolated", {
            driftLower: formatPercent(reading.lower.drift_pct / 100, 1),
            daysLower: reading.lower.age_days,
            driftUpper: formatPercent(reading.upper.drift_pct / 100, 1),
            daysUpper: reading.upper.age_days,
        });
    }
    return t("network.overview.staleness.basis", {
        drift: formatPercent(reading.point.drift_pct / 100, 1),
        days: reading.point.age_days,
    });
}
