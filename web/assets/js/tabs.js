// Hash-based tab router for the top-level navigation.
//
// Why hash and not History API: hashes work over file:// loads (so
// contributors can open index.html without a server), survive reloads
// for deep links, and need no server-side rewriting - the right
// trade-off for a static, GitHub-Pages-style dashboard.
//
// Intentionally tiny: no UI, no framework, only toggles the
// `is-active` class on every `[data-tab-link]` and `[data-tab-panel]`;
// CSS handles the rest. The links are plain `<a href="#...">`, so
// middle-click and "copy link" work out of the box.

const ACTIVE_CLASS = "is-active";

/**
 * Wire up tab navigation for the current document.
 *
 * @param {object} [opts]
 * @param {string} [opts.defaultTab] - tab to show when the URL
 *   carries no hash, or a hash that does not match any panel.
 * @param {(tab: string) => void} [opts.onActivate] - called with the
 *   resolved tab id whenever a tab becomes active: once at init and on
 *   every tab navigation. Lets a caller defer per-tab work (e.g. lazy-
 *   loading the diff payload). Fires on tab switches, not on in-fragment
 *   state changes (those use replaceState), so callers still guard
 *   against repeats.
 * @returns {{ activate(tab: string): void, current(): string }}
 *   Tiny handle for callers that need to read or force-switch
 *   the active tab (e.g. focus management after a deep link).
 */
export function initTabs({ defaultTab, onActivate } = {}) {
    const links = Array.from(document.querySelectorAll("[data-tab-link]"));
    const panels = Array.from(document.querySelectorAll("[data-tab-panel]"));
    const knownTabs = new Set(panels.map((p) => p.dataset.tabPanel));

    const fallback = defaultTab && knownTabs.has(defaultTab)
        ? defaultTab
        : panels[0]?.dataset.tabPanel ?? null;

    // Tabs may carry their own state in the fragment after a "?", e.g.
    // "#diff?a=2026-02-05&b=2026-03-05". The router only reads the
    // leading token; the query suffix is owned by the tab module.
    const tabFromHash = () => {
        const raw = window.location.hash.replace(/^#/, "");
        const token = raw.split("?", 1)[0];
        return knownTabs.has(token) ? token : fallback;
    };

    const activate = (tab) => {
        const next = knownTabs.has(tab) ? tab : fallback;
        if (!next) return;
        for (const link of links) {
            const isActive = link.dataset.tabLink === next;
            link.classList.toggle(ACTIVE_CLASS, isActive);
            if (isActive) {
                link.setAttribute("aria-current", "page");
            } else {
                link.removeAttribute("aria-current");
            }
        }
        for (const panel of panels) {
            // `hidden` does the layout work; `is-active` is kept in
            // sync for hooks that want a class selector.
            const isActive = panel.dataset.tabPanel === next;
            panel.classList.toggle(ACTIVE_CLASS, isActive);
            panel.hidden = !isActive;
        }
        if (onActivate) onActivate(next);
    };

    activate(tabFromHash());

    window.addEventListener("hashchange", () => activate(tabFromHash()));

    return {
        activate,
        current: () =>
            links.find((l) => l.classList.contains(ACTIVE_CLASS))?.dataset
                .tabLink ?? fallback,
    };
}
