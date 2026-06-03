// Network tab hero: four snapshot cards describing the most recent
// crawl of the primary source, scored against the build in effect at
// that time. Mirrors the Maps tab overview-cards layout (card label +
// big metric + unit + delta line) so the two tabs feel of a piece.
//
//   1. Reachable nodes      observed clearnet peers, IPv4/IPv6 split
//   2. AS concentration     HHI of the observed node set
//   3. Peer-diversity buckets   ASmap AS buckets vs Core's defaults
//   4. Map staleness        how far a ~1-year-old map drifts for
//                           today's nodes (read off the decay curve)

import { formatNumber, formatPercent } from "../../format.js";
import { mutedNote } from "../../utils/dom.js";
import { t } from "../../utils/i18n.js";
import { createInfoTooltip } from "../info-tooltip.js";

const TARGET_STALENESS_DAYS = 365;

export function mount(parent, { snapshot, decay }) {
    if (!parent) return;
    if (!snapshot) {
        parent.replaceChildren(mutedNote(t("network.overview.empty")));
        return;
    }
    const row = document.createElement("div");
    row.className = "card-row";
    row.append(
        nodesCard(snapshot),
        concentrationCard(snapshot),
        bucketsCard(snapshot),
        stalenessCard(decay),
    );
    parent.replaceChildren(row);
}

// Just the headline count: the source / snapshot date is stated once
// at the section level (network-tab.js), and the IPv4/IPv6 split bar
// was dropped because it collided visually and numerically with the
// Maps tab's prefix-family bar (~80/20 in both) while measuring a
// different population. The IPv4-dominance rationale moved to the
// info tooltip.
function nodesCard(snapshot) {
    const card = createCard(t("network.overview.nodes.label"), {
        info: t("network.overview.nodes.info"),
        infoAria: t("network.overview.nodes.infoAria"),
    });
    card.append(metricNumber(formatNumber(snapshot.nodes_clearnet)));
    card.append(metricUnit(t("network.overview.nodes.unit")));
    return card;
}

// Leads with the HHI itself rather than the single largest operator's
// share: the largest-operator percentage can fall while concentration
// is merely redistributed to the #2 operator, so HHI — summed over the
// whole AS distribution — is the honest headline. What HHI is and how it
// is computed lives in the info tooltip; the card stays to the bare
// number so it reads at a glance.
function concentrationCard(snapshot) {
    const card = createCard(t("network.overview.concentration.label"), {
        info: t("network.overview.concentration.info"),
        infoAria: t("network.overview.concentration.infoAria"),
    });
    card.append(metricNumber(snapshot.hhi.toFixed(3)));
    card.append(metricUnit(t("network.overview.concentration.unit")));
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

// Reads the decay curve rather than a single diff: picks the point
// closest to one year of map age and reports how much of today's
// node set that map would mislocate, plus the annualised rate.
function stalenessCard(decay) {
    const card = createCard(t("network.overview.staleness.label"), {
        info: t("network.overview.staleness.info"),
        infoAria: t("network.overview.staleness.infoAria"),
    });
    const point = pickStalenessPoint(decay);
    if (!point) {
        card.append(metricNumber("\u2014"));
        card.append(metricUnit(t("network.overview.staleness.noData")));
        return card;
    }
    // The headline is the annualised rate, not the raw drift at the
    // nearest build: the build closest to one year is rarely exactly
    // 365 days old (discrete release cadence), so "X% in 398 days"
    // reads as an arbitrary window. Normalising to a per-year figure
    // is the comparable, intuitive number; the raw reading and its
    // exact age move to the context line below.
    const annualised = point.age_days
        ? (point.drift_pct * TARGET_STALENESS_DAYS) / point.age_days
        : 0;
    card.append(metricNumber(formatPercent(annualised / 100, 1)));
    card.append(metricUnit(t("network.overview.staleness.unit")));
    card.append(
        deltaLine(
            t("network.overview.staleness.basis", {
                drift: formatPercent(point.drift_pct / 100, 1),
                days: point.age_days,
            }),
        ),
    );
    return card;
}

// Prefer the curve point nearest one year of age; fall back to the
// oldest (largest-age) point so the card stays populated even when
// the build history is shorter than a year.
function pickStalenessPoint(decay) {
    const points = (decay?.points ?? []).filter((p) => p.age_days > 0);
    if (points.length === 0) return null;
    let best = points[0];
    for (const point of points) {
        const closer =
            Math.abs(point.age_days - TARGET_STALENESS_DAYS) <
            Math.abs(best.age_days - TARGET_STALENESS_DAYS);
        if (closer) best = point;
    }
    return best;
}

// ---- card primitives (mirrors overview-cards.js) ----------------

function createCard(label, { info, infoAria } = {}) {
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
