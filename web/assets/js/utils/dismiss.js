// Outside-dismiss wiring shared by the popover components (the
// dropdown combobox and the info tooltip). While a popover is open,
// any pointer press or scroll that lands outside ``root`` closes it,
// and a viewport resize re-runs the caller's reposition pass. The
// component owns its own open/close state, keyboard model, and
// placement maths; this only manages the four window/document
// listeners both popovers wire identically.
//
// Returns { attach, detach }. Call attach() when the popover opens and
// detach() when it closes. The internal handler reference is stable
// across attach/detach so removeEventListener always matches.
//
//   - ``root``: the element that scopes "inside"; a press or scroll
//     whose target is not contained by it counts as outside.
//   - ``onDismiss``: called on an outside press or scroll (typically
//     a setOpen(false)).
//   - ``reposition``: called on window resize so the open popover can
//     re-place itself against the moved trigger.
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
