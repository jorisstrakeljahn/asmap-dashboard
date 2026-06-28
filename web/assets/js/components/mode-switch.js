// Pill-style segmented toggle: one active "mode" from a small set of
// mutually exclusive options. Built as an ARIA 1.2 tablist (no
// panels) so the row announces as a coordinated tab group, not N
// independent buttons.
//
//   createModeSwitch({
//       options: [{ value: "a", label: "A" }, { value: "b", ... }],
//       value: "a",
//       onChange: (next) => { ... },
//       ariaLabel: "Comparison mode",
//   })
//
// An option may carry an ``icon`` (inline SVG string): the segment
// renders icon + label in separate spans (.mode-switch__icon /
// .mode-switch__label) so CSS can show both or collapse to icon-only.
//
// Returns the root exposing setValue(v) for external state sync (does
// NOT fire onChange) and setLabel(value, text) for late localisation
// of a segment's visible + accessible name.

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
    if (options.some((opt) => opt.icon)) {
        root.classList.add("mode-switch--with-icons");
    }

    // Sliding highlight. place() writes its width + translateX from
    // the active button's box; CSS tweens on a mode change.
    // aria-hidden: pure decoration, the state is announced via the
    // buttons' aria-selected.
    const pill = document.createElement("span");
    pill.className = "mode-switch__pill";
    pill.setAttribute("aria-hidden", "true");
    root.append(pill);

    let current = value;

    const buttons = options.map((opt, idx) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "mode-switch__btn";
        btn.setAttribute("role", "tab");
        btn.dataset.value = opt.value;
        btn.dataset.idx = String(idx);
        if (opt.icon) {
            // Icon is decorative - the adjacent label (visible, or
            // hidden-but-present via CSS) carries the accessible name,
            // which setLabel() can refresh after i18n strings arrive.
            const icon = document.createElement("span");
            icon.className = "mode-switch__icon";
            icon.setAttribute("aria-hidden", "true");
            icon.innerHTML = opt.icon;
            const label = document.createElement("span");
            label.className = "mode-switch__label";
            label.textContent = opt.label;
            btn.append(icon, label);
        } else {
            btn.textContent = opt.label;
        }
        btn.addEventListener("click", () => commit(opt.value));
        btn.addEventListener("keydown", handleKeydown);
        root.append(btn);
        return btn;
    });

    // Move the pill under the active button. ``animate`` true tweens
    // via CSS (a real mode change); false snaps instantly by
    // suspending the transition across a forced reflow - used for
    // first layout, tab reveal, and viewport / font reflows. The
    // pill's left:0 shares the track's padding edge with offsetLeft,
    // so offsetLeft is the exact translateX with no 1px border fudge.
    function place(animate) {
        const active =
            buttons.find((btn) => btn.dataset.value === current) ?? buttons[0];
        // offsetParent is null while an ancestor is display:none (a
        // hidden tab panel); skip until the ResizeObserver fires on
        // reveal, when the row finally has measurable geometry.
        if (!active || active.offsetParent === null) return;
        if (!animate) pill.style.transition = "none";
        pill.style.width = `${active.offsetWidth}px`;
        pill.style.transform = `translateX(${active.offsetLeft}px)`;
        if (!animate) {
            void pill.offsetWidth;
            pill.style.transition = "";
        }
    }

    function commit(next) {
        if (current === next) return;
        current = next;
        paint();
        place(true);
        if (onChange) onChange(next);
    }

    // ARIA tab-pattern keyboard model: Arrows move the active tab
    // with wrap-around, Home / End jump to the ends. Selection
    // follows focus (no panels to defer to, no expensive work). The
    // roving tabindex from paint() keeps one tab stop for the group,
    // so Tab / Shift+Tab moves to the next control, not each segment.
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

    // Snap the pill once the row has geometry. The rAF covers the
    // common case (mounted into a visible parent) before first paint;
    // the ResizeObserver covers later size changes - a hidden tab
    // revealing, viewport / font reflows.
    requestAnimationFrame(() => place(false));
    new ResizeObserver(() => place(false)).observe(root);

    root.setValue = (next) => {
        if (current === next) return;
        current = next;
        paint();
        place(true);
    };
    root.getValue = () => current;

    // Late-binding label setter so a caller that mounted before i18n
    // loaded can swap in the localised text without rebuilding.
    // Updates the label span or button text, then re-snaps the pill
    // since new text can change the active segment's width.
    root.setLabel = (value, text) => {
        const btn = buttons.find((b) => b.dataset.value === value);
        if (!btn) return;
        const label = btn.querySelector(".mode-switch__label");
        if (label) label.textContent = text;
        else btn.textContent = text;
        place(false);
    };
    return root;
}
