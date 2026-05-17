// Pagination window picker + button rendering for the Top
// Movers footer. paginationWindow is pure for ease of testing.

import { ELLIPSIS } from "../../utils/symbols.js";
import { t } from "../../utils/i18n.js";

// Below this many pages we render every index; above it we elide
// to first + last + a window around the active page.
const PAGINATION_FULL_THRESHOLD = 7;

// Filtering can shrink the matrix below the active page; snap
// back to the last in-range page so the body never lands on an
// empty slice.
export function clampPageIndex(state, filteredCount) {
    if (filteredCount === 0) {
        state.pageIndex = 0;
        return;
    }
    const lastPage = Math.max(
        0,
        Math.ceil(filteredCount / state.pageSize) - 1,
    );
    if (state.pageIndex > lastPage) state.pageIndex = lastPage;
}

export function paginationWindow(active, total) {
    if (total <= PAGINATION_FULL_THRESHOLD) {
        return Array.from({ length: total }, (_, i) => i);
    }
    const pages = new Set([0, total - 1]);
    for (let p = active - 1; p <= active + 1; p++) {
        if (p > 0 && p < total - 1) pages.add(p);
    }
    // Near the edges, expand inward so the active page never
    // hides inside a two-button block like "1 2 … 10".
    if (active <= 2) [1, 2].forEach((p) => pages.add(p));
    if (active >= total - 3) {
        [total - 3, total - 2].forEach((p) => pages.add(p));
    }

    const sorted = [...pages].sort((a, b) => a - b);
    const result = [];
    for (let i = 0; i < sorted.length; i++) {
        result.push(sorted[i]);
        if (i < sorted.length - 1 && sorted[i + 1] - sorted[i] > 1) {
            result.push("ellipsis");
        }
    }
    return result;
}

export function renderPagination(filteredMovers, state, onChange) {
    const totalPages = Math.ceil(filteredMovers.length / state.pageSize);
    if (totalPages <= 1) return [];

    return paginationWindow(state.pageIndex, totalPages).map((entry) => {
        if (entry === "ellipsis") return ellipsisToken();
        return pageButton(entry, state, onChange);
    });
}

function ellipsisToken() {
    const span = document.createElement("span");
    span.className = "top-movers__page-ellipsis";
    span.textContent = ELLIPSIS;
    span.setAttribute("aria-hidden", "true");
    return span;
}

function pageButton(index, state, onChange) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "top-movers__page";
    if (index === state.pageIndex) {
        button.classList.add("is-active");
        button.setAttribute("aria-current", "page");
    }
    button.textContent = String(index + 1);
    button.setAttribute(
        "aria-label",
        t("topMovers.pagination.pageAria", { n: index + 1 }),
    );
    button.addEventListener("click", () => {
        state.pageIndex = index;
        onChange();
    });
    return button;
}
