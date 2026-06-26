// Loading skeleton for the Diff Explorer.
//
// Mirrors the real layout (selectors + results card + Top Movers table) so the
// swap to loaded content is layout-free, and keeps every static label real -
// only data-derived values are shimmer bars. diffs.json loads lazily on first
// Diff-tab open (see app.js); this fills the gap. Same column classes as the
// live table (top-movers/columns.js) so widths align.

import { html } from "../../vendor/lit-html.js";
import { ARROW } from "../../utils/symbols.js";
import { renderToElement } from "../../utils/dom.js";
import { t } from "../../utils/i18n.js";
import { FAMILY_IPV6 } from "../../format.js";

const SKELETON_ROW_COUNT = 8;

// One shimmer bar; ``extra`` adds size modifier(s) from skeleton.css.
const bar = (extra = "") =>
    html`<span class=${`skeleton skeleton__bar ${extra}`.trim()}></span>`;

// Returns the skeleton root element so the caller can set aria-hidden and
// drop it into the diff slot (see diff-tab.js).
export function createDiffSkeleton({ family } = {}) {
    const isV6 = family === FAMILY_IPV6;
    return renderToElement(html`
        <div class="diff-explorer diff-explorer--skeleton">
            ${selectorsSkeleton()} ${resultsSkeleton(isV6)}
        </div>
    `);
}

const selectorsSkeleton = () => html`
    <div class="diff-selectors">
        <div class="diff-selectors__row">
            ${selectorField(t("diff.selectors.mapA"))}
            <span class="diff-selectors__arrow" aria-hidden="true">${ARROW.RIGHT}</span>
            ${selectorField(t("diff.selectors.mapB"))}
        </div>
    </div>
`;

const selectorField = (labelText) => html`
    <div class="diff-selectors__field">
        <span class="diff-selectors__label">${labelText}</span>
        ${bar("skeleton__control")}
    </div>
`;

const resultsSkeleton = (isV6) => html`
    <div class="diff-explorer__results">
        ${matchCardSkeleton(isV6)} ${topMoversSkeleton(isV6)}
    </div>
`;

const matchCardSkeleton = (isV6) => html`
    <article class="card diff-results">
        ${matchBannerSkeleton(isV6)} ${classificationSkeleton()}
        <div class="stacked-bar skeleton"></div>
    </article>
`;

const matchBannerSkeleton = (isV6) => html`
    <div class="match-banner">
        <div class="match-banner__family">
            <div class="match-banner__headline">${bar("skeleton__bar--headline")}</div>
            <div class="match-banner__caption">
                ${t(isV6 ? "diff.matchBanner.ipv6Caption" : "diff.matchBanner.ipv4Caption")}
            </div>
            <div class="match-banner__detail">${bar("skeleton__bar--lg")}</div>
            <div class="match-banner__source">${bar("skeleton__bar--md")}</div>
        </div>
    </div>
`;

const CLASSIFICATION_CELLS = [
    ["diff.categories.reassigned", "classification-cell__label--reassigned"],
    ["diff.categories.newlyMapped", "classification-cell__label--new"],
    ["diff.categories.unmapped", "classification-cell__label--unmapped"],
];

const classificationSkeleton = () => html`
    <div class="classification-row">
        ${CLASSIFICATION_CELLS.map(
            ([labelKey, labelClass]) => html`
                <div class="classification-cell">
                    <div class="classification-cell__value">
                        ${bar("skeleton__bar--value")}
                    </div>
                    <div class="classification-cell__label ${labelClass}">
                        ${t(labelKey)}
                    </div>
                </div>
            `,
        )}
    </div>
`;

const topMoversSkeleton = (isV6) => html`
    <article class="card top-movers">
        <header class="top-movers__header">
            <span class="card__label uppercase-label">${t("topMovers.title")}</span>
            <div class="top-movers__header-controls">
                ${bar("skeleton__pill skeleton__pill--wide")}
            </div>
        </header>
        <div class="top-movers__toolbar">
            <div class="top-movers__toolbar-fields">
                ${bar("skeleton__input")} ${bar("skeleton__pill skeleton__pill--wide")}
            </div>
        </div>
        <div class="top-movers__table">${topMoversTableSkeleton(isV6)}</div>
        <footer class="top-movers__footer">
            ${bar("skeleton__bar--md")} ${bar("skeleton__pill skeleton__pill--wide")}
        </footer>
    </article>
`;

const topMoversTableSkeleton = (isV6) => html`
    <table class="top-movers__grid">
        ${topMoversHead(isV6)} ${topMoversBody()}
    </table>
`;

const headColumns = (isV6) => [
    ["top-movers__rank", null],
    ["top-movers__asn", "topMovers.columns.as"],
    [
        "top-movers__num",
        isV6 ? "topMovers.shareDenominator.ipv6" : "topMovers.shareDenominator.ipv4",
    ],
    ["top-movers__direction", "topMovers.columns.direction"],
];

// Rank header stays blank like the live table; the share column names the
// active family so it matches the header that mounts in its place.
const topMoversHead = (isV6) => html`
    <thead>
        <tr>
            ${headColumns(isV6).map(
                ([className, labelKey]) =>
                    html`<th class=${className}>${labelKey ? t(labelKey) : ""}</th>`,
            )}
        </tr>
    </thead>
`;

const topMoversBody = () => html`
    <tbody>
        ${Array.from({ length: SKELETON_ROW_COUNT }, () => topMoversRow())}
    </tbody>
`;

// AS identity is a number line plus a thinner operator-name line, matching
// the detailed view's two-line asn-cell.
const topMoversRow = () => html`
    <tr>
        <td class="top-movers__rank">${bar("skeleton__bar--xs")}</td>
        <td class="top-movers__asn">
            <span class="asn-cell">
                ${bar("skeleton__bar--sm")} ${bar("skeleton__bar--name")}
            </span>
        </td>
        <td class="top-movers__num">${bar("skeleton__bar--sm")}</td>
        <td class="top-movers__direction">${bar("skeleton__bar--lg")}</td>
    </tr>
`;
