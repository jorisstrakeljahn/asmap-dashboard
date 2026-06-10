// Network tab hero: five snapshot cards describing the most recent
// crawl of the primary source, scored against the build in effect at
// that time. Mirrors the Maps tab overview-cards layout (card label +
// big metric + unit + delta line) so the two tabs feel of a piece.
//
// Row 1 — the two findings, half-width-larger lead cards:
//   1. AS concentration     HHI of the observed node set — "does
//                           ASmap improve peer diversity right now?"
//   2. Map staleness        how far a ~1-year-old map drifts for
//                           today's nodes — "how often must Core
//                           ship a fresh map?" (off the decay curve)
// Row 2 — the context those findings rest on:
//   3. Reachable nodes      observed clearnet peers, IPv4/IPv6 split
//   4. Nakamoto coefficient ASes needed to reach 50 % of mapped nodes
//   5. Peer-diversity buckets   ASmap AS buckets vs Core's defaults
//
// ASmap coverage (share of nodes the map resolves) deliberately has
// no card: it idles at ~99.9% and reads as noise here; its story —
// the dips between releases — lives in the coverage trend chart.

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
    const leads = [concentrationCard(snapshot), stalenessCard(decay)];
    for (const card of leads) card.classList.add("card--lead");
    row.append(
        ...leads,
        nodesCard(snapshot),
        nakamotoCard(snapshot),
        bucketsCard(snapshot),
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
    card.append(
        deltaLine(familySplitLine(snapshot, (f) => f.nodes ?? 0, formatNumber)),
    );
    return card;
}

// The blunt adversarial reading of the AS distribution: how many
// autonomous systems an attacker would have to control to sit next
// to half of the mapped listening nodes. Higher is healthier. The
// 50 % threshold matches the convention used for consensus-layer
// Nakamoto coefficients, so the number is comparable across studies.
function nakamotoCard(snapshot) {
    const card = createCard(t("network.overview.nakamoto.label"), {
        info: t("network.overview.nakamoto.info"),
        infoAria: t("network.overview.nakamoto.infoAria"),
    });
    if (snapshot.nakamoto_50 == null) {
        card.append(metricNumber("\u2014"));
        card.append(metricUnit(t("network.overview.nakamoto.noData")));
        return card;
    }
    card.append(metricNumber(formatNumber(snapshot.nakamoto_50)));
    card.append(metricUnit(t("network.overview.nakamoto.unit")));
    card.append(
        deltaLine(
            t("network.overview.nakamoto.basis", {
                mapped: formatNumber(snapshot.mapped),
            }),
        ),
    );
    return card;
}

// "IPv4 8,602, IPv6 1,732"-style context line shared by the cards
// that carry a per-family split. ``pick`` reads the value off one
// family slice, ``format`` renders it.
function familySplitLine(snapshot, pick, format) {
    const families = snapshot.families ?? {};
    return t("network.overview.familySplit", {
        ipv4: format(pick(families.ipv4 ?? {})),
        ipv6: format(pick(families.ipv6 ?? {})),
    });
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

// Reads the decay curve at exactly one year of map age and reports
// how much of today's node set a map that old would mislocate. The
// headline is a one-year figure rather than the raw drift at the
// nearest build: builds are not released exactly 365 days apart, so
// "X% in 398 days" would read as an arbitrary window. The context
// line below names the curve points the reading rests on.
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
//   1. Two curve points bracket the one-year mark: interpolate
//      linearly between them. The reading stays on the measured
//      curve, so no scaling artefact can enter the headline.
//   2. A point sits exactly on the mark: take it as is.
//   3. The history is one-sided (all builds younger than a year,
//      or — after a long publishing gap — all older): scale the
//      point nearest the mark by 365 / age. This is a linear
//      extrapolation that amplifies whatever noise the single
//      point carries by that same factor, which is why it is the
//      fallback and not the rule, and why the basis line labels
//      it differently.
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
