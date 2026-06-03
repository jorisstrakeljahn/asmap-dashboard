// Mobile navigation menu. The burger button toggles the primary
// nav into a dropdown panel below the header. Everything here is
// inert on desktop: the button ships `display: none`, so the
// listeners simply never fire until a narrow viewport reveals it.
//
// The nav links themselves are still plain `<a href="#...">`
// elements driving tabs.js via the hash router — this module only
// owns the open/closed state of the panel, not tab selection.

export function initNavMenu() {
    const toggle = document.querySelector("[data-nav-toggle]");
    const nav = document.getElementById("site-nav");
    if (!toggle || !nav) return;

    const isOpen = () => nav.classList.contains("is-open");

    const setOpen = (open) => {
        nav.classList.toggle("is-open", open);
        toggle.setAttribute("aria-expanded", String(open));
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

    // Returning to a wide viewport (rotation, resize) must not leave
    // a stale open panel that the now-hidden burger can't close.
    const wide = window.matchMedia("(min-width: 721px)");
    wide.addEventListener("change", (event) => {
        if (event.matches) setOpen(false);
    });
}
