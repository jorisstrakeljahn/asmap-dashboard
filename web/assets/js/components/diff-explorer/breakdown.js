// Match banner, classification cells, stacked bar, and AS
// roster delta. All four read DIFF_CATEGORIES so labels,
// colours, and bar segments stay in sync.

import { formatNumber, formatPercent } from "../../format.js";
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

export function matchBanner(diff) {
    const denom = Math.max(diff.entries_a, diff.entries_b);
    const matchRate = denom ? 1 - diff.total_changes / denom : 1;
    const wrap = document.createElement("div");
    wrap.className = "match-banner";

    const headRow = document.createElement("div");
    headRow.className = "match-banner__row";

    const headline = document.createElement("span");
    headline.className = "match-banner__headline";
    headline.textContent = formatPercent(matchRate, 1);

    const detail = document.createElement("span");
    detail.className = "match-banner__detail";
    detail.textContent = t("diff.matchBanner.detail", {
        changes: formatNumber(diff.total_changes),
        denom: formatNumber(denom),
    });

    headRow.append(headline, detail);

    // Variant caption answers "what kind of comparison is this?"
    // — read from the diff payload so a future filled-vs-filled
    // diff cannot silently masquerade as source data.
    const variantLabel = VARIANT_LABEL_KEYS[diff.variant]
        ? t(VARIANT_LABEL_KEYS[diff.variant])
        : diff.variant || t("common.variants.unknown");
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
    const { field, labelKey, modifier } = category;
    const value = diff[field];
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

    // IPv4 / IPv6 split caption. Bitcoin Core peer selection
    // treats the two families as separate diversity dimensions,
    // so the breakdown matters when "reassigned" is large.
    const v4 = diff[`${field}_ipv4`];
    const v6 = diff[`${field}_ipv6`];
    if (value > 0 && v4 !== undefined && v6 !== undefined) {
        const familyEl = document.createElement("p");
        familyEl.className = "classification-cell__family";
        familyEl.textContent = t("diff.familySplit", {
            v4: formatNumber(v4),
            v6: formatNumber(v6),
        });
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
