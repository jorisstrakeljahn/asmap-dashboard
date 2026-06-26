// Match banner, classification cells, stacked bar, and AS roster delta. All
// four are family-scoped via the Diff Explorer master toggle, so they speak the
// same v4 / v6 language. DIFF_CATEGORIES keeps labels, colours, and bar
// segments in sync.

import { html, nothing, render } from "../../vendor/lit-html.js";
import {
    FAMILY_IPV4,
    FAMILY_IPV6,
    formatNumber,
    formatPercent,
    glueUnits,
} from "../../format.js";
import { t } from "../../utils/i18n.js";
import { cloneSheetContext, createInfoTooltip } from "../info-tooltip.js";

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

// Match rate banner, one family at a time, in the NetGroup bucket vocabulary
// Core's GetGroup() uses with no asmap (IPv4 /16 buckets, IPv6 /32 blocks),
// which keeps the columns comparable across 2^32 vs 2^128 of address space.
export function matchBanner(diff, family) {
    const view = matchBannerView(diff, family);

    // Variant caption read from the payload so a future filled-vs-filled diff
    // can't masquerade as source data.
    const variantLabel = VARIANT_LABEL_KEYS[diff.variant]
        ? t(VARIANT_LABEL_KEYS[diff.variant])
        : diff.variant || t("common.variants.unknown");

    return html`
        <div class="match-banner">
            ${familyBlock({
                captionKey: CAPTION_KEY_BY_FAMILY[family],
                view,
                family,
                variantLabel,
            })}
        </div>
    `;
}

// Denominator is the union of both maps' coverage; a changed prefix is mapped
// on at least one side, so changed buckets are a subset of the union and the
// percentage stays in [0, 100] (a single map's count wouldn't guarantee that).
// matchBannerView returns the same shape for both families so familyBlock never
// branches on family.
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
    // Glue only the unit ("IPv4 /16 buckets") so "/16" never orphans, while the
    // sentence keeps its normal wrap points. Gluing the whole string would fuse
    // every digit-adjacent space into one unbreakable run that overflows a
    // narrow card.
    const detail = t("diff.matchBanner.detail", {
        changed: view.format(view.changed),
        denominator: view.format(view.denominator),
        unit: glueUnits(t(UNIT_LABEL_KEY_BY_FAMILY[family])),
    });

    return html`
        <div class="match-banner__family match-banner__family--${family}">
            <span class="match-banner__headline">${formatPercent(1 - view.ratio, 2)}</span>
            <span class="match-banner__caption">${t(captionKey)}</span>
            <span class="match-banner__detail">${detail}</span>
            <span class="match-banner__source">${variantLabel}</span>
        </div>
    `;
}

// Classification cards are family-scoped so they speak the same currency as the
// stacked bar and match banner. The caption shows the family figure, not the
// combined v4 + v6 total.
export function classificationRow(diff, family) {
    return html`
        <div class="classification-row">
            ${DIFF_CATEGORIES.map((category) =>
                classificationCell(category, diff, family),
            )}
        </div>
    `;
}

function classificationCell({ field, labelKey, modifier }, diff, family) {
    return html`
        <div class="classification-cell">
            <p class="classification-cell__value">${formatNumber(
                familyValue(diff, field, family),
            )}</p>
            <p
                class="classification-cell__label classification-cell__label--${modifier}"
            >${t(labelKey)}</p>
        </div>
    `;
}

// Per-family classification count. Falls back to zero for the rare case where
// one family is untouched in a diff.
function familyValue(diff, field, family) {
    const suffix = family === FAMILY_IPV6 ? "ipv6" : "ipv4";
    return diff[`${field}_${suffix}`] ?? 0;
}

// Stacked bar shares are over the family-scoped total, so the percentages add
// up in the same currency as the cards above.
export function stackedBar(diff, family) {
    const total = Math.max(familyTotalChanges(diff, family), 1);
    return html`
        <div class="stacked-bar">
            ${DIFF_CATEGORIES.map(({ field, modifier }) => {
                const value = familyValue(diff, field, family);
                return value === 0 ? nothing : stackedSegment(value / total, modifier);
            })}
        </div>
    `;
}

function familyTotalChanges(diff, family) {
    return DIFF_CATEGORIES.reduce(
        (sum, { field }) => sum + familyValue(diff, field, family),
        0,
    );
}

function stackedSegment(share, modifier) {
    return html`<div
        class="stacked-bar__segment stacked-bar__segment--${modifier}"
        style="flex-grow: ${share}"
    >${formatPercent(share, 1)}</div>`;
}

// "appeared"/"disappeared" are AS-roster terms, distinct from the prefix terms
// "newly mapped"/"unmapped" (a prefix moving to an existing AS doesn't change
// the roster). Returns null on older payloads without as_total_*, so the card
// never shows a fake "0 → 0 ASes".
export function rosterDeltaRow(diff) {
    if (diff.as_total_a === undefined || diff.as_total_b === undefined) {
        return null;
    }
    // Own divided section so it reads as a distinct map-level line, not a
    // footnote on the stacked bar. Stays a real element so its info tooltip can
    // clone the section's children for the mobile sheet header.
    const section = document.createElement("div");
    section.className = "as-roster-delta";

    const tip = createInfoTooltip({
        body: t("diff.rosterDeltaInfo"),
        ariaLabel: t("diff.rosterDeltaInfoAria"),
        // Mobile sheet leads with this section's roster line (AS totals,
        // appeared/disappeared) so the reader keeps the context.
        sheetHeader: () => cloneSheetContext(section),
    });
    tip.classList.add("as-roster-delta__info");

    const text = glueUnits(
        t("diff.rosterDelta", {
            a: formatNumber(diff.as_total_a),
            b: formatNumber(diff.as_total_b),
            appeared: formatNumber(diff.as_appeared ?? 0),
            disappeared: formatNumber(diff.as_disappeared ?? 0),
        }),
    );

    render(html`${tip}<p class="as-roster-delta__text">${text}</p>`, section);
    return section;
}
