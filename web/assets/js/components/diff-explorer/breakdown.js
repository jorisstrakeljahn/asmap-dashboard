// Match banner, classification cells, stacked bar, and AS
// roster delta. All four are family scoped — the Diff Explorer
// master toggle decides which family they render, so the
// surfaces always speak the same v4 / v6 language at the same
// time. DIFF_CATEGORIES keeps labels, colours, and bar segments
// in sync between the cells and the bar.

import {
    FAMILY_IPV4,
    FAMILY_IPV6,
    formatNumber,
    formatPercent,
    glueUnits,
} from "../../format.js";
import { t } from "../../utils/i18n.js";
import { createInfoTooltip } from "../info-tooltip.js";

export const DIFF_CATEGORIES = [
    {
        field: "reassigned",
        labelKey: "diff.categories.reassigned",
        modifier: "reassigned",
    },
    {
        field: "newly_mapped",
        labelKey: "diff.categories.newlyMapped",
        modifier: "new",
    },
    {
        field: "unmapped",
        labelKey: "diff.categories.unmapped",
        modifier: "unmapped",
    },
];

const VARIANT_LABEL_KEYS = {
    unfilled: "common.variants.unfilled",
    filled: "common.variants.filled",
};

const CAPTION_KEY_BY_FAMILY = {
    [FAMILY_IPV4]: "diff.matchBanner.ipv4Caption",
    [FAMILY_IPV6]: "diff.matchBanner.ipv6Caption",
};

const UNIT_LABEL_KEY_BY_FAMILY = {
    [FAMILY_IPV4]: "diff.matchBanner.unit.ipv4",
    [FAMILY_IPV6]: "diff.matchBanner.unit.ipv6",
};

// Match rate banner. One family at a time, picked by the Diff
// Explorer master toggle. Both families speak the peer-diversity
// bucket vocabulary Bitcoin Core's CNetAddr::GetGroup() uses
// when no asmap is loaded: IPv4 in /16 buckets, IPv6 in /32
// NetGroup blocks. That makes the two columns directly
// comparable ("buckets carrying a changed prefix" /
// "buckets the map covers") even though one is 2^32 and the
// other is 2^128 of underlying address space.
export function matchBanner(diff, family) {
    const view = matchBannerView(diff, family);

    const wrap = document.createElement("div");
    wrap.className = "match-banner";

    // Variant caption answers what kind of comparison this is.
    // The label is read from the diff payload so a future
    // filled vs filled diff cannot silently masquerade as
    // source data. It rides along as the block's third stacked
    // line (under the bucket detail) so the banner reads on the
    // same rail as the node-impact block below it.
    const variantLabel = VARIANT_LABEL_KEYS[diff.variant]
        ? t(VARIANT_LABEL_KEYS[diff.variant])
        : diff.variant || t("common.variants.unknown");

    const block = familyBlock({
        captionKey: CAPTION_KEY_BY_FAMILY[family],
        view,
        family,
        variantLabel,
    });

    wrap.append(block);
    return wrap;
}

// Both families speak in NetGroup buckets so the headline
// percent is directly comparable: /16 buckets on IPv4, /32
// blocks on IPv6. Both columns come straight from the pipeline,
// which counts them over merged prefix ranges.
//
// The denominator is the union of both maps' coverage — every
// bucket either map has an opinion about. A changed prefix is
// mapped on at least one side, so the changed buckets are a
// subset of the union by construction and the match percentage
// is guaranteed to stay within [0, 100]. A single map's bucket
// count would not give that guarantee: a newly mapped prefix
// only exists in Map B's coverage, an unmapped one only in
// Map A's.
//
// Returns the same {changed, denominator, ratio, format} shape
// for both families so familyBlock() never has to branch on
// family again.
const BANNER_FIELDS_BY_FAMILY = {
    [FAMILY_IPV4]: {
        changed: "ipv4_buckets_changed",
        space: "ipv4_bucket_space_union",
    },
    [FAMILY_IPV6]: {
        changed: "ipv6_blocks_changed",
        space: "ipv6_block_space_union",
    },
};

function matchBannerView(diff, family) {
    const fields = BANNER_FIELDS_BY_FAMILY[family];
    const changed = diff[fields.changed] || 0;
    const denominator = diff[fields.space] || 0;
    return {
        ratio: denominator ? changed / denominator : 0,
        changed,
        denominator,
        format: formatNumber,
    };
}

function familyBlock({ captionKey, view, family, variantLabel }) {
    const block = document.createElement("div");
    block.className = `match-banner__family match-banner__family--${family}`;

    const headline = document.createElement("span");
    headline.className = "match-banner__headline";
    headline.textContent = formatPercent(1 - view.ratio, 2);

    const captionEl = document.createElement("span");
    captionEl.className = "match-banner__caption";
    captionEl.textContent = t(captionKey);

    const detail = document.createElement("span");
    detail.className = "match-banner__detail";
    detail.textContent = glueUnits(
        t("diff.matchBanner.detail", {
            changed: view.format(view.changed),
            denominator: view.format(view.denominator),
            unit: t(UNIT_LABEL_KEY_BY_FAMILY[family]),
        }),
    );

    const source = document.createElement("span");
    source.className = "match-banner__source";
    source.textContent = variantLabel;

    block.append(headline, captionEl, detail, source);
    return block;
}

// Classification cards scope to a single family so the headline
// numbers, the stacked bar below, and the match banner all speak
// the same currency. The caption shows the family-scoped figure
// rather than the combined v4 + v6 total, which is more useful
// once the user has picked a side.
export function classificationRow(diff, family) {
    const row = document.createElement("div");
    row.className = "classification-row";
    for (const category of DIFF_CATEGORIES) {
        row.append(classificationCell(category, diff, family));
    }
    return row;
}

function classificationCell(category, diff, family) {
    const { field, labelKey, modifier } = category;
    const value = familyValue(diff, field, family);
    const node = document.createElement("div");
    node.className = "classification-cell";

    const valueEl = document.createElement("p");
    valueEl.className = "classification-cell__value";
    valueEl.textContent = formatNumber(value);

    const labelEl = document.createElement("p");
    labelEl.className =
        `classification-cell__label classification-cell__label--${modifier}`;
    labelEl.textContent = t(labelKey);

    node.append(valueEl, labelEl);
    return node;
}

// Reads the per-family classification count. Falls back to
// zero for the rare case where one family is genuinely
// untouched in a diff (the field is always present in the
// payload, but defensive code is cheap here).
function familyValue(diff, field, family) {
    const suffix = family === FAMILY_IPV6 ? "ipv6" : "ipv4";
    return diff[`${field}_${suffix}`] ?? 0;
}

// Stacked bar shares are taken over the family-scoped total so
// the percentages add up within the same currency as the cards
// above. A diff with 17,819 IPv4 reassigned and 3,327 IPv6
// reassigned would have rendered identical bars before the
// family scope — now each family gets its own honest split.
export function stackedBar(diff, family) {
    const total = Math.max(familyTotalChanges(diff, family), 1);
    const wrap = document.createElement("div");
    wrap.className = "stacked-bar";
    for (const { field, modifier } of DIFF_CATEGORIES) {
        const value = familyValue(diff, field, family);
        if (value === 0) continue;
        wrap.append(stackedSegment(value / total, modifier));
    }
    return wrap;
}

function familyTotalChanges(diff, family) {
    return DIFF_CATEGORIES.reduce(
        (sum, { field }) => sum + familyValue(diff, field, family),
        0,
    );
}

function stackedSegment(share, modifier) {
    const fill = document.createElement("div");
    fill.className = `stacked-bar__segment stacked-bar__segment--${modifier}`;
    fill.style.flexGrow = String(share);
    fill.textContent = formatPercent(share, 1);
    return fill;
}

// "appeared" / "disappeared" are AS-roster terms, deliberately
// distinct from the prefix-entry terms "newly mapped" /
// "unmapped": a prefix newly mapped to an existing AS does not
// change the roster. Returns null on older payloads without
// as_total_*, so the card never reads "0 → 0 ASes" as if it
// were a real measurement.
export function rosterDeltaRow(diff) {
    if (diff.as_total_a === undefined || diff.as_total_b === undefined) {
        return null;
    }
    // Its own divided section with an info icon, so it reads as a
    // distinct line (map-level AS roster) rather than a footnote
    // glued to the stacked bar. Family-agnostic by design.
    const section = document.createElement("div");
    section.className = "as-roster-delta";

    const tip = createInfoTooltip({
        body: t("diff.rosterDeltaInfo"),
        ariaLabel: t("diff.rosterDeltaInfoAria"),
    });
    tip.classList.add("as-roster-delta__info");

    const text = document.createElement("p");
    text.className = "as-roster-delta__text";
    text.textContent = glueUnits(
        t("diff.rosterDelta", {
            a: formatNumber(diff.as_total_a),
            b: formatNumber(diff.as_total_b),
            appeared: formatNumber(diff.as_appeared ?? 0),
            disappeared: formatNumber(diff.as_disappeared ?? 0),
        }),
    );

    section.append(tip, text);
    return section;
}
