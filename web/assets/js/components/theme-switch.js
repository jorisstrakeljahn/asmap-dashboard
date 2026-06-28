// Light / Dark theme control mounted in the site header.
//
// The widget is the dashboard's segmented mode-switch (same
// sliding-pill control as the other toggles), icon-only - sun and
// moon - with the text label kept in the accessibility tree.
//
// State model - two explicit themes, system preference as the
// first-visit default:
//   - Stored *preference* is "light" | "dark", or null when the
//     visitor has never toggled. Persisted in localStorage.
//   - *Resolved* theme is what paints: the preference if set,
//     otherwise prefers-color-scheme. A new visitor follows the OS;
//     the first toggle pins an explicit choice.
//   - While no choice is stored the control tracks the OS live; once
//     the user picks, the OS is ignored.
//
// First paint is handled by an inline boot script in index.html (sets
// data-theme before stylesheets apply, so no light flash on a
// dark-preference reload). This module re-applies on mount, wires the
// OS listener, and owns every later toggle.

import { readSetting, writeSetting } from "../utils/storage.js";
import { t } from "../utils/i18n.js";
import { createModeSwitch } from "./mode-switch.js";

const THEME_KEY = "asmap.theme";
const THEMES = ["light", "dark"];

const darkQuery =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-color-scheme: dark)")
        : null;

const reducedMotionQuery =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;

// Inline SVGs (stroke = currentColor so they inherit the segment's
// text colour, matching the burger icon's drawing style).
const ICONS = {
    light: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`,
    dark: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,
};

// English fallbacks used at mount time, before i18n strings are
// guaranteed loaded. localize() swaps in dictionary values once they
// arrive; this also keeps the control correct on the data-load error
// page where translations may never run.
const FALLBACK_LABELS = { light: "Light", dark: "Dark" };
const FALLBACK_ARIA = "Theme";

function resolveTheme(preference) {
    if (preference === "dark") return "dark";
    if (preference === "light") return "light";
    return darkQuery && darkQuery.matches ? "dark" : "light";
}

let transitionTimer = 0;

// Flip the document to the resolved theme. ``animate`` runs the
// whole-page colour cross-fade (see .theme-transition in base.css) for
// an explicit toggle; the initial mount and OS-driven re-resolves snap
// instantly. Reduced-motion users always snap.
function applyTheme(preference, { animate = false } = {}) {
    const resolved = resolveTheme(preference);
    const root = document.documentElement;
    const motionOk = !(reducedMotionQuery && reducedMotionQuery.matches);
    if (animate && motionOk) {
        root.classList.add("theme-transition");
        window.clearTimeout(transitionTimer);
        transitionTimer = window.setTimeout(() => {
            root.classList.remove("theme-transition");
        }, 400);
    }
    root.setAttribute("data-theme", resolved);
}

export function initThemeSwitch() {
    const slot = document.querySelector("[data-theme-switch]");
    // Guard against a double-mount: the flag makes a stray second call
    // a no-op rather than two stacked controls fighting over the same
    // preference.
    if (!slot || slot.dataset.mounted === "true") return null;
    slot.dataset.mounted = "true";

    // null = no explicit choice yet → follow the OS. readSetting
    // returns the fallback for an unset key or any stale value, so a
    // leftover "system" degrades to OS-follow too.
    let preference = readSetting(THEME_KEY, THEMES, null);
    applyTheme(preference);

    const control = createModeSwitch({
        options: THEMES.map((value) => ({
            value,
            label: FALLBACK_LABELS[value],
            icon: ICONS[value],
        })),
        // The active segment reflects what is actually painting, so a
        // first-time visitor on a dark OS sees the moon pre-selected.
        value: resolveTheme(preference),
        ariaLabel: FALLBACK_ARIA,
        onChange: (next) => {
            preference = next;
            writeSetting(THEME_KEY, next);
            applyTheme(next, { animate: true });
        },
    });
    control.classList.add("theme-switch");
    slot.replaceChildren(control);

    // While no explicit choice is stored, track the OS: re-resolve and
    // re-point the active segment when it flips. addEventListener is
    // modern; older Safari only has addListener, hence the fallback.
    if (darkQuery) {
        const onSystemChange = () => {
            if (preference !== null) return;
            applyTheme(null, { animate: true });
            if (typeof control.setValue === "function") {
                control.setValue(resolveTheme(null));
            }
        };
        if (typeof darkQuery.addEventListener === "function") {
            darkQuery.addEventListener("change", onSystemChange);
        } else if (typeof darkQuery.addListener === "function") {
            darkQuery.addListener(onSystemChange);
        }
    }

    return control;
}

// Refresh the visible labels + group name from the i18n dictionary
// once loaded (the control mounts earlier to apply the theme without
// delay). Safe with strings missing - t() falls back to the key.
export function localizeThemeSwitch(control) {
    if (!control) return;
    control.setAttribute("aria-label", t("header.theme.ariaLabel"));
    for (const value of THEMES) {
        if (typeof control.setLabel === "function") {
            control.setLabel(value, t(`header.theme.${value}`));
        }
    }
}
