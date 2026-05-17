// Pill-style segmented toggle. A single active "mode" is picked
// from a small set of mutually exclusive options; the visual
// language matches the dashboard accent and is reused anywhere a
// boolean / few-state choice deserves more weight than a checkbox.
//
// Built as an ARIA 1.2 tablist (without panels) so the pill row
// announces itself as a coordinated group of selectable tabs to
// screen readers, not as N independent buttons.
//
//   createModeSwitch({
//       options: [{ value: "a", label: "A" }, { value: "b", ... }],
//       value: "a",
//       onChange: (next) => { ... },
//       ariaLabel: "Comparison mode",
//   })
//
// Returns the root element exposing setValue(v) for external
// state sync (does NOT fire onChange, mirroring the native
// <select>.value = x semantic).

export function createModeSwitch({
    options,
    value,
    onChange,
    ariaLabel,
}) {
    const root = document.createElement("div");
    root.className = "mode-switch";
    root.setAttribute("role", "tablist");
    if (ariaLabel) root.setAttribute("aria-label", ariaLabel);

    let current = value;

    const buttons = options.map((opt, idx) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "mode-switch__btn";
        btn.setAttribute("role", "tab");
        btn.dataset.value = opt.value;
        btn.dataset.idx = String(idx);
        btn.textContent = opt.label;
        btn.addEventListener("click", () => commit(opt.value));
        btn.addEventListener("keydown", handleKeydown);
        root.append(btn);
        return btn;
    });

    function commit(next) {
        if (current === next) return;
        current = next;
        paint();
        if (onChange) onChange(next);
    }

    // ARIA Authoring Practices keyboard model for the tab pattern:
    // ArrowLeft / ArrowRight move the active tab with wrap-around,
    // Home / End jump to the ends. Selection follows focus because
    // the pill is a "select on focus" toggle (no panels to defer
    // until activation, and the mode switch doesn't trigger
    // network / expensive work). The roving tabindex maintained by
    // paint() keeps a single tab stop for the whole group, so Tab
    // / Shift+Tab still moves to the next/previous control rather
    // than walking through each pill segment.
    function handleKeydown(ev) {
        const currentIdx = buttons.indexOf(ev.currentTarget);
        if (currentIdx < 0) return;
        let nextIdx = -1;
        switch (ev.key) {
            case "ArrowRight":
            case "ArrowDown":
                nextIdx = (currentIdx + 1) % buttons.length;
                break;
            case "ArrowLeft":
            case "ArrowUp":
                nextIdx = (currentIdx - 1 + buttons.length) % buttons.length;
                break;
            case "Home":
                nextIdx = 0;
                break;
            case "End":
                nextIdx = buttons.length - 1;
                break;
            default:
                return;
        }
        ev.preventDefault();
        const nextBtn = buttons[nextIdx];
        commit(nextBtn.dataset.value);
        nextBtn.focus();
    }

    function paint() {
        for (const btn of buttons) {
            const active = btn.dataset.value === current;
            btn.classList.toggle("is-active", active);
            btn.setAttribute("aria-selected", active ? "true" : "false");
            btn.tabIndex = active ? 0 : -1;
        }
    }
    paint();

    root.setValue = (next) => {
        if (current === next) return;
        current = next;
        paint();
    };
    root.getValue = () => current;
    return root;
}
