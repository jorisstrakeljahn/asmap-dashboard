// Three-way classification breakdown that sits between the
// selectors and the Top Movers table. Four pieces:
//
//   matchBanner       — headline match-rate + variant caption
//   classificationRow — three labelled bucket counters (with the
//                       IPv4/IPv6 split caption when present)
//   stackedBar        — same three buckets as a flex bar
//   rosterDeltaRow    — "ASes: A -> B (+appeared, -disappeared)"
//
// All four read the same DIFF_CATEGORIES list so the labels,
// colours, and bar segments can never drift apart. The combined
// DIFF_RESULTS_INFO tooltip explains every bucket in one place.

import { ARROW, EM_DASH, MINUS } from "../../utils/symbols.js";
import { formatNumber, formatPercent } from "../../format.js";

// Single source of truth for the three diff classifications.
// Same order, labels and CSS modifiers feed both the headline
// row and the stacked bar.
//
//   field    — key in the diff payload
//   label    — human-readable name
//   modifier — BEM modifier used on .classification-cell__label
//              (label colour) and .stacked-bar__segment
export const DIFF_CATEGORIES = [
    { field: "reassigned", label: "Reassigned", modifier: "reassigned" },
    { field: "newly_mapped", label: "Newly Mapped", modifier: "new" },
    { field: "unmapped", label: "Unmapped", modifier: "unmapped" },
];

// Combined explainer for the three classification buckets,
// rendered as a single card-corner tooltip on .diff-results. One
// labelled paragraph per bucket reads as a glossary while
// keeping the visual surface free of three separate icons.
export const DIFF_RESULTS_INFO = [
    "Each entry-level change between Map A and Map B falls into exactly one of three buckets.",
    {
        lead: "Reassigned.",
        text: "A prefix was mapped in both Map A and Map B, but now resolves to a different autonomous system. This is where most ASmap edits land.",
    },
    {
        lead: "Newly Mapped.",
        text: "A prefix had no autonomous system in Map A and now resolves to one in Map B.",
    },
    {
        lead: "Unmapped.",
        text: "A prefix that resolved to an autonomous system in Map A no longer resolves to one in Map B.",
    },
    "The caption under each bucket splits the count by address family. Bitcoin Core peer diversity treats IPv4 and IPv6 as separate dimensions, so a diff that moves 10 000 IPv4 prefixes has a different operational signature than one that moves 10 000 IPv6 prefixes.",
    {
        lead: "AS roster delta.",
        text: "The footer line under the stacked bar tracks how many distinct autonomous systems each build maps, plus how many appeared (present in Map B but not in Map A) and disappeared (present in A but not in B). Appeared \u2212 disappeared equals the \"+N vs previous\" delta on the Unique ASes overview card for the same pair \u2014 the two views agree on the same arithmetic.",
    },
    "Computed from the unfilled (source data) variant of each build, so each change is a real BGP / RPKI / IRR shift rather than a fill-heuristic artefact.",
];

// Human-readable label for the asmap variant field stored on
// each diff. Today the pipeline only emits unfilled-vs-unfilled
// pairs, but the variant field on the payload future-proofs the
// headline so a filled-vs-filled diff would not silently
// masquerade as a raw source-data comparison.
const VARIANT_LABELS = {
    unfilled: "Source data (unfilled)",
    filled: "Embedded (filled)",
};

export function matchBanner(diff) {
    const denom = Math.max(diff.entries_a, diff.entries_b);
    const matchRate = denom ? 1 - diff.total_changes / denom : 1;
    const wrap = document.createElement("div");
    wrap.className = "match-banner";

    // Headline + count caption share one baseline so the eye
    // reads "95.0% match — 22,614 of 455,725 entries differ" as
    // a single sentence even when the viewport is narrow enough
    // to wrap.
    const headRow = document.createElement("div");
    headRow.className = "match-banner__row";

    const headline = document.createElement("span");
    headline.className = "match-banner__headline";
    headline.textContent = formatPercent(matchRate, 1);

    const detail = document.createElement("span");
    detail.className = "match-banner__detail";
    detail.textContent =
        `match ${EM_DASH} ${formatNumber(diff.total_changes)} of ` +
        `${formatNumber(denom)} entries differ`;

    headRow.append(headline, detail);

    // Variant caption answers "what kind of comparison is this?"
    // without forcing the reader to open the explainer tooltip.
    // The dates live in the Map A / Map B selectors directly
    // above the banner, so they would only echo here. The
    // variant field is read straight from the diff payload so a
    // future filled-vs-filled diff would not be silently
    // mislabelled as source data.
    const variantLabel =
        VARIANT_LABELS[diff.variant] || diff.variant || "Unknown variant";
    const caption = document.createElement("p");
    caption.className = "match-banner__variant";
    caption.textContent = variantLabel;

    wrap.append(headRow, caption);
    return wrap;
}

export function classificationRow(diff) {
    const row = document.createElement("div");
    row.className = "classification-row";
    for (const category of DIFF_CATEGORIES) {
        row.append(classificationCell(category, diff));
    }
    return row;
}

function classificationCell(category, diff) {
    const { field, label, modifier } = category;
    const value = diff[field];
    const node = document.createElement("div");
    node.className = "classification-cell";

    const valueEl = document.createElement("p");
    valueEl.className = "classification-cell__value";
    valueEl.textContent = formatNumber(value);

    // The label colour matches the bucket's segment in the
    // stacked bar directly below. The redundant percentage row
    // that used to sit between the value and the label was
    // dropped because the bar already encodes those proportions
    // visually.
    const labelEl = document.createElement("p");
    labelEl.className =
        `classification-cell__label classification-cell__label--${modifier}`;
    labelEl.textContent = label;

    node.append(valueEl, labelEl);

    // Address-family caption: surfaces whether this bucket is
    // mostly IPv4 or IPv6 churn. Bitcoin Core peer selection
    // treats the two families as separate diversity dimensions,
    // so a reviewer looking at a fat "reassigned" number wants
    // to know which side moved. Suppressed on zero-value buckets
    // (no signal to convey) and on older payloads without the
    // split (graceful fallback).
    const v4 = diff[`${field}_ipv4`];
    const v6 = diff[`${field}_ipv6`];
    if (value > 0 && v4 !== undefined && v6 !== undefined) {
        const familyEl = document.createElement("p");
        familyEl.className = "classification-cell__family";
        familyEl.textContent =
            `${formatNumber(v4)} IPv4 + ${formatNumber(v6)} IPv6`;
        node.append(familyEl);
    }

    return node;
}

export function stackedBar(diff) {
    const total = diff.total_changes || 1;
    const wrap = document.createElement("div");
    wrap.className = "stacked-bar";
    for (const { field, modifier } of DIFF_CATEGORIES) {
        const value = diff[field];
        if (value === 0) continue;
        wrap.append(stackedSegment(value / total, modifier));
    }
    return wrap;
}

function stackedSegment(share, modifier) {
    const fill = document.createElement("div");
    fill.className = `stacked-bar__segment stacked-bar__segment--${modifier}`;
    fill.style.flexGrow = String(share);
    fill.textContent = formatPercent(share, 1);
    return fill;
}

// AS roster delta line. Sits below the stacked bar to answer the
// "how many distinct ASes are we talking about?" question that
// the three entry-level buckets cannot speak to. Returns null
// when the payload lacks the as_total_* fields (older
// metrics.json) so the card never falls back to "0 → 0 ASes",
// which would look like a real measurement instead of missing
// data.
//
// Wording note: "appeared" / "disappeared" are AS-roster terms,
// deliberately different from the bucket names "newly mapped" /
// "unmapped" which apply to prefix entries. A prefix that is
// newly mapped to an existing AS does not change the roster.
export function rosterDeltaRow(diff) {
    if (diff.as_total_a === undefined || diff.as_total_b === undefined) {
        return null;
    }
    const a = formatNumber(diff.as_total_a);
    const b = formatNumber(diff.as_total_b);
    const appeared = formatNumber(diff.as_appeared ?? 0);
    const disappeared = formatNumber(diff.as_disappeared ?? 0);
    const p = document.createElement("p");
    p.className = "as-roster-delta";
    // Parenthesised delta keeps the headline pair (A -> B count)
    // visually dominant while the breakdown stays one glance
    // away. Comma instead of a bullet because the two halves are
    // paired counts of the same delta, not a list of independent
    // facts.
    p.textContent =
        `ASes: ${a} ${ARROW.RIGHT} ${b} ` +
        `(+${appeared} appeared, ${MINUS}${disappeared} disappeared)`;
    return p;
}
