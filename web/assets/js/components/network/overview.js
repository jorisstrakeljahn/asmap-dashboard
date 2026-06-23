// Network tab hero: up to six snapshot cards on the most recent crawl
// of the primary source, scored against the build in effect then.
// Mirrors the Maps tab overview-cards layout so the tabs feel of a
// piece.
//
// Two cards per row, each a coherent pair so the grid reads as three
// themes:
//   Row 1 — diversity / adversary
//     1. AS concentration     HHI of the observed node set — "does
//                             ASmap improve peer diversity right now?"
//     2. ASes to reach 50%    fewest operators that together hold half
//                             the mapped nodes (the 50%-control headcount)
//   Row 2 — map freshness / churn
//     3. Map staleness        how far a ~1-year-old map drifts for
//                             today's nodes (off the decay curve)
//     4. Latest update impact observed nodes the newest release moved
//                             (optional — only when network.json carries it)
//   Row 3 — raw context
//     5. Reachable nodes      observed clearnet peers, IPv4/IPv6 split
//     6. Peer-diversity buckets   ASmap AS buckets vs Core's defaults
//
// ASmap coverage has no card: it idles at ~99.9% and reads as noise
// here; its story lives in the coverage trend chart.

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

export function mount(parent, { snapshot, decay, latestUpdate }) {
    if (!parent) return;
    if (!snapshot) {
        parent.replaceChildren(mutedNote(t("network.overview.empty")));
        return;
    }
    const row = document.createElement("div");
    row.className = "card-row";
    // The optional latest-update card slots into row 2 next to
    // staleness (both speak to map freshness); without it, nodes/
    // buckets reflow up so the pairing degrades without a hole.
    const cards = [
        concentrationCard(snapshot),
        reach50Card(snapshot),
        stalenessCard(decay),
    ];
    if (latestUpdate) cards.push(latestUpdateCard(latestUpdate));
    cards.push(nodesCard(snapshot), bucketsCard(snapshot));
    row.append(...cards);
    parent.replaceChildren(row);
}

// Just the headline count: the source / snapshot date is stated once
// at the section level. The IPv4/IPv6 split bar was dropped — it
// collided with the Maps tab's prefix-family bar (~80/20 in both)
// while measuring a different population; its rationale moved to the
// info tooltip.
function nodesCard(snapshot) {
    const card = createCard(t("network.overview.nodes.label"), {
        info: t("network.overview.nodes.info"),
        infoAria: t("network.overview.nodes.infoAria"),
    });
    card.append(metricNumber(formatNumber(snapshot.nodes_clearnet)));
    card.append(metricUnit(t("network.overview.nodes.unit")));
    card.append(
        deltaLine(familySplitLine(snapshot, (f) => f.nodes ?? 0, formatNumber)),
    );
    return card;
}

// Adversarial reading of the AS distribution: the fewest operators an
// attacker must control to sit next to half the mapped listening nodes.
// Higher is healthier. The 50 % threshold is the standard cut-off
// decentralisation studies use, so it's comparable across them. The
// data field, the function, and this card all read "ASes to reach
// 50%" end to end (decentralisation studies call the same number the
// AS Nakamoto coefficient).
function reach50Card(snapshot) {
    const card = createCard(t("network.overview.reach50.label"), {
        info: t("network.overview.reach50.info"),
        infoAria: t("network.overview.reach50.infoAria"),
    });
    if (snapshot.ases_to_50pct == null) {
        card.append(metricNumber("\u2014"));
        card.append(metricUnit(t("network.overview.reach50.noData")));
        return card;
    }
    card.append(metricNumber(formatNumber(snapshot.ases_to_50pct)));
    card.append(metricUnit(t("network.overview.reach50.unit")));
    card.append(
        deltaLine(
            t("network.overview.reach50.basis", {
                mapped: formatNumber(snapshot.mapped),
            }),
        ),
    );
    return card;
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

// Leads with HHI, not the largest operator's share: that share can
// fall while concentration just shifts to the #2 operator, so HHI —
// summed over the whole AS distribution — is the honest headline.
// What HHI is lives in the info tooltip.
function concentrationCard(snapshot) {
    const card = createCard(t("network.overview.concentration.label"), {
        info: t("network.overview.concentration.info"),
        infoAria: t("network.overview.concentration.infoAria"),
    });
    card.append(metricNumber(snapshot.hhi.toFixed(3)));
    card.append(metricUnit(t("network.overview.concentration.unit")));
    card.append(
        deltaLine(familySplitLine(snapshot, (f) => f.hhi ?? 0, (v) => v.toFixed(3))),
    );
    return card;
}

function bucketsCard(snapshot) {
    const card = createCard(t("network.overview.buckets.label"), {
        info: t("network.overview.buckets.info"),
        infoAria: t("network.overview.buckets.infoAria"),
    });
    const bucketing = snapshot.bucketing;
    card.append(metricNumber(formatNumber(bucketing.asmap_groups)));
    card.append(metricUnit(t("network.overview.buckets.unit")));
    card.append(
        deltaLine(
            t("network.overview.buckets.vsDefault", {
                count: formatNumber(bucketing.default_groups),
                ratio: bucketing.reduction_ratio.toFixed(1),
            }),
        ),
    );
    return card;
}

// How many observed nodes changed AS when the most recent map shipped,
// vs the build just before it. The Diff Explorer numbers made concrete
// on the real node set: the headline is the count that moved, the line
// below splits it into the same three buckets.
function latestUpdateCard(latestUpdate) {
    const card = createCard(t("network.overview.latestUpdate.label"), {
        info: t("network.overview.latestUpdate.info"),
        infoAria: t("network.overview.latestUpdate.infoAria"),
    });
    card.append(metricNumber(formatNumber(latestUpdate.total_affected)));
    card.append(metricUnit(t("network.overview.latestUpdate.unit")));
    card.append(
        deltaLine(
            t("network.overview.latestUpdate.basis", {
                reassigned: formatNumber(latestUpdate.reassigned),
                newlyMapped: formatNumber(latestUpdate.newly_mapped),
                unmapped: formatNumber(latestUpdate.unmapped),
            }),
        ),
    );
    return card;
}

// Reads the decay curve at exactly one year of map age: how much of
// today's node set a map that old would mislocate. A one-year figure,
// not the raw drift at the nearest build, since builds aren't 365 days
// apart and "X% in 398 days" would read as arbitrary. The context line
// names the curve points the reading rests on.
function stalenessCard(decay) {
    const card = createCard(t("network.overview.staleness.label"), {
        info: t("network.overview.staleness.info"),
        infoAria: t("network.overview.staleness.infoAria"),
    });
    const reading = stalenessAtTarget(decay);
    if (!reading) {
        card.append(metricNumber("\u2014"));
        card.append(metricUnit(t("network.overview.staleness.noData")));
        return card;
    }
    card.append(metricNumber(formatPercent(reading.value / 100, 1)));
    card.append(metricUnit(t("network.overview.staleness.unit")));
    card.append(deltaLine(stalenessBasis(reading)));
    return card;
}

// Reads the curve at TARGET_STALENESS_DAYS. Three cases:
//
//   1. Two points bracket the one-year mark: interpolate linearly,
//      so the reading stays on the measured curve.
//   2. A point sits exactly on the mark: take it as is.
//   3. One-sided history (all builds younger, or — after a long
//      gap — all older): scale the nearest point by 365 / age, a
//      linear extrapolation through the origin. A real decay curve
//      saturates, so this over-estimates from a younger anchor and
//      under-estimates from an older one, and amplifies that point's
//      noise by 365 / age — hence the fallback, labelled differently
//      in the basis line. Live data brackets the mark, so case 1
//      applies.
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
            // A build exactly one year old — the curve answers
            // the question directly.
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
