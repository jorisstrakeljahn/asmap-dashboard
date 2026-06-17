// Mobile navigation menu. The burger button toggles the primary nav
// into a full-screen overlay; inert on desktop, where the button is
// display:none so listeners never fire.
//
// Nav links stay plain `<a href="#...">` driving tabs.js via the
// hash router — this module owns only the panel's open/closed state
// (and, on a phone, where the theme switch lives), not tab selection.

export function initNavMenu() {
    const toggle = document.querySelector("[data-nav-toggle]");
    const nav = document.getElementById("site-nav");
    if (!toggle || !nav) return;

    // The theme switch sits in the header on desktop but at the bottom
    // of the menu on a phone. Rather than mount two controls (which
    // would fight over the stored preference), relocate the single node
    // between header and a nav footer as the viewport crosses the
    // breakpoint. theme-switch.js finds the slot by selector wherever
    // it sits, so the move is transparent.
    const themeSlot = document.querySelector("[data-theme-switch]");
    const actions = document.querySelector(".site-header__actions");
    const menuFooter = document.createElement("div");
    menuFooter.className = "site-nav__footer";

    const narrow = window.matchMedia("(max-width: 720px)");

    const placeTheme = () => {
        if (!themeSlot || !actions) return;
        if (narrow.matches) {
            menuFooter.append(themeSlot);
            nav.append(menuFooter);
        } else {
            // Back into the header cluster, ahead of the burger so the
            // original left-of-burger order is preserved.
            actions.insertBefore(themeSlot, toggle);
            menuFooter.remove();
        }
    };

    const isOpen = () => nav.classList.contains("is-open");

    const setOpen = (open) => {
        nav.classList.toggle("is-open", open);
        toggle.setAttribute("aria-expanded", String(open));
        // Lock the page behind the full-screen overlay so a scroll
        // gesture moves the menu, not the dashboard underneath it.
        document.body.classList.toggle("has-nav-open", open);
        if (open) {
            // Capture phase so a tap that lands on a tab link still
            // closes the panel before the link's own handler runs.
            document.addEventListener("pointerdown", onOutside, true);
            document.addEventListener("keydown", onKey, true);
        } else {
            document.removeEventListener("pointerdown", onOutside, true);
            document.removeEventListener("keydown", onKey, true);
        }
    };

    const onOutside = (event) => {
        if (!nav.contains(event.target) && !toggle.contains(event.target)) {
            setOpen(false);
        }
    };

    const onKey = (event) => {
        if (event.key === "Escape") {
            setOpen(false);
            toggle.focus();
        }
    };

    toggle.addEventListener("click", () => setOpen(!isOpen()));

    // A nav tap selects a tab; collapse the panel so it does not
    // cover the content the user just navigated to.
    nav.addEventListener("click", (event) => {
        if (event.target.closest("[data-tab-link]")) setOpen(false);
    });

    // Crossing the breakpoint (rotation, resize) re-homes the theme
    // switch and clears any open panel so the now-hidden burger can't
    // leave a stale overlay covering the desktop layout.
    narrow.addEventListener("change", () => {
        setOpen(false);
        placeTheme();
    });

    placeTheme();
}
