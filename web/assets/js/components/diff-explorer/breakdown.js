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
} from "../../format.js";
import { t } from "../../utils/i18n.js";

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

    const block = familyBlock({
        captionKey: CAPTION_KEY_BY_FAMILY[family],
        view,
        family,
    });

    // Variant caption answers what kind of comparison this is.
    // The label is read from the diff payload so a future
    // filled vs filled diff cannot silently masquerade as
    // source data.
    const variantLabel = VARIANT_LABEL_KEYS[diff.variant]
        ? t(VARIANT_LABEL_KEYS[diff.variant])
        : diff.variant || t("common.variants.unknown");
    const caption = document.createElement("p");
    caption.className = "match-banner__variant";
    caption.textContent = variantLabel;

    wrap.append(block, caption);
    return wrap;
}

// Both families speak in NetGroup buckets so the headline
// percent is directly comparable: /16 buckets on IPv4, /32
// blocks on IPv6. IPv4 buckets come straight from the pipeline.
// IPv6 buckets are derived from the address fields by the same
// >> 96 shift formatIpv6Blocks does — staying in block space
// keeps the values inside the Number-safe range (a /32 block
// count is ~10^5, well below 2^53) and avoids BigInt in
// Math.max, which would throw.
//
// Both branches return the same {changed, denominator, ratio,
// format} shape so familyBlock() never has to branch on
// family again.
function matchBannerView(diff, family) {
    if (family === FAMILY_IPV6) {
        const changed = toIpv6Blocks(diff.ipv6_addresses_changed);
        const denominator = Math.max(
            toIpv6Blocks(diff.ipv6_address_space_a),
            toIpv6Blocks(diff.ipv6_address_space_b),
        );
        return {
            ratio: denominator ? changed / denominator : 0,
            changed,
            denominator,
            format: formatNumber,
        };
    }
    const changed = diff.ipv4_buckets_changed || 0;
    const denominator = Math.max(
        diff.ipv4_bucket_space_a || 0,
        diff.ipv4_bucket_space_b || 0,
    );
    return {
        ratio: denominator ? changed / denominator : 0,
        changed,
        denominator,
        format: formatNumber,
    };
}

// ``raw`` is an integer count of IPv6 addresses, which can blow
// past Number.MAX_SAFE_INTEGER on the address-space columns. We
// promote to BigInt only long enough to shift down to /32 block
// count, which always fits in Number cleanly. Mirrors what
// formatIpv6Blocks does for display.
const IPV6_NETGROUP_BITS = 96n;

function toIpv6Blocks(raw) {
    if (raw == null) return 0;
    try {
        return Number(BigInt(raw) >> IPV6_NETGROUP_BITS);
    } catch {
        return 0;
    }
}

function familyBlock({ captionKey, view, family }) {
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
    detail.textContent = t("diff.matchBanner.detail", {
        changed: view.format(view.changed),
        denominator: view.format(view.denominator),
        unit: t(UNIT_LABEL_KEY_BY_FAMILY[family]),
    });

    block.append(headline, captionEl, detail);
    return block;
}

// Classification cards now scope to a single family so the
// headline numbers, the stacked bar below, and the match banner
// all speak the same currency. The combined ``field`` value
// (entry totals across both families) used to surface in the
// caption; the breakdown into v4 / v6 entries is more useful
// when the user already picked a side, so the family-scoped
// figure stands alone now.
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
    const p = document.createElement("p");
    p.className = "as-roster-delta";
    p.textContent = t("diff.rosterDelta", {
        a: formatNumber(diff.as_total_a),
        b: formatNumber(diff.as_total_b),
        appeared: formatNumber(diff.as_appeared ?? 0),
        disappeared: formatNumber(diff.as_disappeared ?? 0),
    });
    return p;
}
