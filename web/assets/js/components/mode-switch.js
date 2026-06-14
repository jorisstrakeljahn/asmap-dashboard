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
// An option may carry an ``icon`` (an inline SVG markup string).
// When present, the segment renders the icon followed by the label
// in their own spans (.mode-switch__icon / .mode-switch__label) so a
// caller can show both or collapse to icon-only via CSS; segments
// without an icon keep the plain text-node rendering byte-for-byte.
//
// Returns the root element exposing setValue(v) for external
// state sync (does NOT fire onChange, mirroring the native
// <select>.value = x semantic) and setLabel(value, text) for
// late localisation of a segment's visible + accessible name.

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
    // the active button's measured box; CSS tweens between the old
    // and new values on a mode change. aria-hidden because it is
    // pure decoration — the active state is announced via the
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
            // Icon is decorative — the adjacent label (visible, or
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

    // Move the pill under the active button. ``animate`` true lets the
    // CSS transition tween it across (a real mode change); false snaps
    // it instantly by suspending the transition across a forced reflow
    // — used for first layout, tab reveal, and viewport / font
    // reflows, so the highlight is never a frame behind or seen
    // sliding in from the left on load. offsetLeft and the pill's
    // left:0 share the same origin (the track's padding edge), so the
    // button's offsetLeft is the exact translateX — no border fudge,
    // which would push the pill 1px off and unbalance the inset.
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

    // Snap the pill the moment the row has geometry. The rAF covers
    // the common case (mounted into a visible parent in the same task)
    // before the first paint; the ResizeObserver covers every later
    // path that gives or changes the row's size — a hidden tab panel
    // becoming visible, and viewport / font reflows that shift the
    // button widths.
    requestAnimationFrame(() => place(false));
    new ResizeObserver(() => place(false)).observe(root);

    root.setValue = (next) => {
        if (current === next) return;
        current = next;
        paint();
        place(true);
    };
    root.getValue = () => current;

    // Late-binding setter so a caller that mounted the switch before
    // i18n strings loaded can swap in the localised label without
    // rebuilding the control. Updates the visible label span (icon
    // segments) or the button text (plain segments), and re-snaps the
    // pill since the new text can change the active segment's width.
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
