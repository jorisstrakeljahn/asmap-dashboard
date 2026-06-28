// Outside-dismiss wiring shared by the popover components (dropdown, info
// tooltip): while open, a pointer press or scroll outside `root` calls
// onDismiss and a resize calls reposition. Just the four shared listeners -
// the component keeps its own state, keyboard model and placement. The handler
// ref is stable so removeEventListener always matches.
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
