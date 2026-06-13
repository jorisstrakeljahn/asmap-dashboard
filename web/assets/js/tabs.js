// Hash-based tab router for the top-level navigation.
//
// Why hash and not History API: hashes work over file:// loads
// (Bitcoin Core contributors often pull the repo and open
// index.html without spinning up a server), survive page reloads
// for deep links, and need no server-side rewriting. The cost is
// the leading "#" in the URL bar, which is the right trade-off
// for a static, GitHub-Pages-style dashboard.
//
// The router is intentionally tiny: it does not own any UI, does
// not depend on a framework, and only mutates two things in the
// DOM — the `is-active` class on every `[data-tab-link]` and on
// every `[data-tab-panel]`. CSS handles the rest (hide inactive
// panels, underline the active link). The tab-link elements are
// regular `<a href="#...">`, so middle-click, right-click, and
// "copy link" do the obvious thing out of the box.

const ACTIVE_CLASS = "is-active";

/**
 * Wire up tab navigation for the current document.
 *
 * @param {object} [opts]
 * @param {string} [opts.defaultTab] - tab to show when the URL
 *   carries no hash, or a hash that does not match any panel.
 * @param {(tab: string) => void} [opts.onActivate] - called with the
 *   resolved tab id whenever a tab becomes active: once at init and
 *   again on every tab navigation. Lets a caller defer per-tab work
 *   (e.g. lazy-loading the heavy diff payload only when the Diff
 *   Explorer is first opened). Fires on tab switches, not on a tab's
 *   own in-fragment state changes (those use replaceState and do not
 *   trigger a hashchange), so callers still guard against repeats.
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

    // Tabs may carry their own state in the fragment after a "?",
    // e.g. "#diff?a=2026-02-05&b=2026-03-05" for a sharable Map A /
    // Map B selection. The router only cares about the leading
    // token; the query suffix is owned by the tab module that
    // mounts into the matching panel.
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
            // `hidden` attribute does the layout work; we still
            // keep `is-active` in sync for hooks that want a
            // class selector (e.g. a future highlight or
            // animation).
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
