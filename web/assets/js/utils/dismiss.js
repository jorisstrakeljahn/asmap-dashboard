// Outside-dismiss wiring shared by the popover components (dropdown
// combobox, info tooltip). While open, a pointer press or scroll
// outside ``root`` closes it and a resize re-runs reposition. Only
// the four shared listeners live here; the component owns its own
// state, keyboard model, and placement maths.
//
// Returns { attach, detach } for open / close. The handler ref is
// stable so removeEventListener always matches.
//
//   - ``root``: scopes "inside"; targets outside count as dismiss.
//   - ``onDismiss``: called on an outside press or scroll.
//   - ``reposition``: called on resize to re-place the popover.
export function createOutsideDismiss({ root, onDismiss, reposition }) {
    const onOutside = (ev) => {
        if (!root.contains(ev.target)) onDismiss();
    };
    return {
        attach() {
            document.addEventListener("mousedown", onOutside, true);
            document.addEventListener("touchstart", onOutside, true);
            window.addEventListener("scroll", onOutside, true);
            window.addEventListener("resize", reposition);
        },
        detach() {
            document.removeEventListener("mousedown", onOutside, true);
            document.removeEventListener("touchstart", onOutside, true);
            window.removeEventListener("scroll", onOutside, true);
            window.removeEventListener("resize", reposition);
        },
    };
}
