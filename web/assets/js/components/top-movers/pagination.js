// Pagination model + DOM builder for the Top Movers footer.
//
// The window picker (which page indices to render with which
// ellipses) is a pure function so it stays trivially testable;
// the rendered buttons consume the picker output and own the
// click handlers.

import { ELLIPSIS } from "../../utils/symbols.js";

// Pagination starts to elide page buttons once the matrix gets
// long enough that printing every index hurts the eye more than
// jumping helps. Below the threshold every page is shown; above
// it we keep the first, last, and a small window around the
// active page (see paginationWindow).
const PAGINATION_FULL_THRESHOLD = 7;

// Filtering can shrink the matrix below the user's current page;
// snap back to the last in-range page so the table never lands
// on an empty slice. Page 0 is the safe fallback when nothing
// matches.
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

// Pick which page indices to render and where to insert
// "ellipsis" tokens. Below PAGINATION_FULL_THRESHOLD pages every
// index is shown; above it we keep the first, last, and a one-
// neighbour window around the active page, with extra slots
// expanded at the ends so "1 2 3 … 10" reads naturally instead
// of "1 2 … 10".
export function paginationWindow(active, total) {
    if (total <= PAGINATION_FULL_THRESHOLD) {
        return Array.from({ length: total }, (_, i) => i);
    }
    const pages = new Set([0, total - 1]);
    for (let p = active - 1; p <= active + 1; p++) {
        if (p > 0 && p < total - 1) pages.add(p);
    }
    // Near the edges, expand the window inward so the user
    // doesn't see a two-button block ("1 2 … 10") that hides
    // their real position.
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
    button.setAttribute("aria-label", `Page ${index + 1}`);
    button.addEventListener("click", () => {
        state.pageIndex = index;
        onChange();
    });
    return button;
}
