// Loading skeleton for the Diff Explorer.
//
// Mirrors the real layout (selectors + results card + Top Movers
// table) so the swap to loaded content is layout-free, and keeps
// every static label real — only data-derived values (percentages,
// counts, dropdown values, table cells) are shimmer bars. So the
// loading state reads as "the page you are about to see", with
// localisation already in place at first paint.
//
// diffs.json is fetched lazily on first Diff-tab open (see app.js);
// this fills the gap. Same column classes as the live table
// (top-movers/columns.js) so widths align.

import { ARROW } from "../../utils/symbols.js";
import { t } from "../../utils/i18n.js";
import { FAMILY_IPV6 } from "../../format.js";

const SKELETON_ROW_COUNT = 8;

// One shimmer bar. ``extra`` is the size modifier(s) from skeleton.css
// (e.g. "skeleton__bar--lg"). Always paired with `.skeleton` for the
// moving gradient.
function bar(extra = "") {
    const span = document.createElement("span");
    span.className = `skeleton skeleton__bar ${extra}`.trim();
    return span;
}

function el(tag, className) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    return node;
}

/**
 * Build the Diff Explorer loading skeleton.
 * @param {object} [opts]
 * @param {string} [opts.family] - active address family, so the share
 *   column header and match caption match what will load.
 * @returns {HTMLElement}
 */
export function createDiffSkeleton({ family } = {}) {
    const isV6 = family === FAMILY_IPV6;
    const root = el("div", "diff-explorer diff-explorer--skeleton");
    root.append(selectorsSkeleton(), resultsSkeleton(isV6));
    return root;
}

function selectorsSkeleton() {
    const selectors = el("div", "diff-selectors");
    const row = el("div", "diff-selectors__row");

    const arrow = el("span", "diff-selectors__arrow");
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = ARROW.RIGHT;

    row.append(
        selectorField(t("diff.selectors.mapA")),
        arrow,
        selectorField(t("diff.selectors.mapB")),
    );
    selectors.append(row);
    return selectors;
}

function selectorField(labelText) {
    const field = el("div", "diff-selectors__field");
    const label = el("span", "diff-selectors__label");
    label.textContent = labelText;
    field.append(label, bar("skeleton__control"));
    return field;
}

function resultsSkeleton(isV6) {
    const results = el("div", "diff-explorer__results");
    results.append(matchCardSkeleton(isV6), topMoversSkeleton(isV6));
    return results;
}

function matchCardSkeleton(isV6) {
    const card = el("article", "card diff-results");
    card.append(matchBannerSkeleton(isV6), classificationSkeleton(), stackedBarSkeleton());
    return card;
}

function matchBannerSkeleton(isV6) {
    const banner = el("div", "match-banner");
    const grid = el("div", "match-banner__family");

    const headline = el("div", "match-banner__headline");
    headline.append(bar("skeleton__bar--headline"));

    const caption = el("div", "match-banner__caption");
    caption.textContent = t(
        isV6 ? "diff.matchBanner.ipv6Caption" : "diff.matchBanner.ipv4Caption",
    );

    const detail = el("div", "match-banner__detail");
    detail.append(bar("skeleton__bar--lg"));

    const source = el("div", "match-banner__source");
    source.append(bar("skeleton__bar--md"));

    grid.append(headline, caption, detail, source);
    banner.append(grid);
    return banner;
}

function classificationSkeleton() {
    const row = el("div", "classification-row");
    const cells = [
        ["diff.categories.reassigned", "classification-cell__label--reassigned"],
        ["diff.categories.newlyMapped", "classification-cell__label--new"],
        ["diff.categories.unmapped", "classification-cell__label--unmapped"],
    ];
    for (const [labelKey, labelClass] of cells) {
        const cell = el("div", "classification-cell");
        const value = el("div", "classification-cell__value");
        value.append(bar("skeleton__bar--value"));
        const label = el("div", `classification-cell__label ${labelClass}`);
        label.textContent = t(labelKey);
        cell.append(value, label);
        row.append(cell);
    }
    return row;
}

// The empty track already reads as a placeholder; the shimmer makes it
// match the other bars while it waits.
function stackedBarSkeleton() {
    return el("div", "stacked-bar skeleton");
}

function topMoversSkeleton(isV6) {
    const card = el("article", "card top-movers");

    const header = el("header", "top-movers__header");
    const title = el("span", "card__label uppercase-label");
    title.textContent = t("topMovers.title");
    const controls = el("div", "top-movers__header-controls");
    controls.append(bar("skeleton__pill skeleton__pill--wide"));
    header.append(title, controls);

    const toolbar = el("div", "top-movers__toolbar");
    const fields = el("div", "top-movers__toolbar-fields");
    fields.append(bar("skeleton__input"), bar("skeleton__pill skeleton__pill--wide"));
    toolbar.append(fields);

    const tableWrap = el("div", "top-movers__table");
    tableWrap.append(topMoversTableSkeleton(isV6));

    const footer = el("footer", "top-movers__footer");
    footer.append(bar("skeleton__bar--md"), bar("skeleton__pill skeleton__pill--wide"));

    card.append(header, toolbar, tableWrap, footer);
    return card;
}

function topMoversTableSkeleton(isV6) {
    const table = el("table", "top-movers__grid");
    table.append(topMoversHead(isV6), topMoversBody());
    return table;
}

// Real column headers (rank is intentionally blank, like the live
// table). The share column names the active family so it matches the
// header that mounts in its place.
function topMoversHead(isV6) {
    const thead = el("thead");
    const tr = el("tr");
    const columns = [
        ["top-movers__rank", null],
        ["top-movers__asn", "topMovers.columns.as"],
        [
            "top-movers__num",
            isV6 ? "topMovers.shareDenominator.ipv6" : "topMovers.shareDenominator.ipv4",
        ],
        ["top-movers__direction", "topMovers.columns.direction"],
    ];
    for (const [className, labelKey] of columns) {
        const th = el("th", className);
        if (labelKey) th.textContent = t(labelKey);
        tr.append(th);
    }
    thead.append(tr);
    return thead;
}

function topMoversBody() {
    const tbody = el("tbody");
    for (let i = 0; i < SKELETON_ROW_COUNT; i++) {
        tbody.append(topMoversRow());
    }
    return tbody;
}

function topMoversRow() {
    const tr = el("tr");

    const rank = el("td", "top-movers__rank");
    rank.append(bar("skeleton__bar--xs"));

    // AS identity: number line + thinner operator-name line, matching
    // the detailed (default) view's two-line asn-cell.
    const asn = el("td", "top-movers__asn");
    const cell = el("span", "asn-cell");
    cell.append(bar("skeleton__bar--sm"), bar("skeleton__bar--name"));
    asn.append(cell);

    const num = el("td", "top-movers__num");
    num.append(bar("skeleton__bar--sm"));

    const direction = el("td", "top-movers__direction");
    direction.append(bar("skeleton__bar--lg"));

    tr.append(rank, asn, num, direction);
    return tr;
}
