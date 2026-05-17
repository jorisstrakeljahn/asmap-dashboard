// Custom combobox dropdown that replaces every native <select>
// across the dashboard. Native popovers are browser- and OS-
// controlled and break the visual language on mobile (iOS /
// Android show their own picker sheet); the custom panel here
// matches the card / shadow / border tokens consistently.
//
// Wires the WAI-ARIA 1.2 collapsible combobox pattern:
// https://www.w3.org/WAI/ARIA/apg/patterns/combobox/
//
// createDropdown({ options, value, onChange, ariaLabel |
// ariaLabelledBy, size, placeholder }) returns an element exposing
// getValue(), setValue(v) and setDisabledValues(values).
// setValue does NOT fire onChange (mirrors the native
// <select>.value = x semantic). ``placeholder`` is the label
// shown when ``value`` is null / unknown - useful for "tap to
// pick"-style triggers that have no preselected option.
//
// Options may carry ``disabled: true`` so the panel renders them
// as a muted, non-interactive line - clicks, Enter and Space all
// no-op on disabled options, and ArrowUp / ArrowDown skip over
// them. setDisabledValues(values) accepts an iterable so callers
// can re-derive the disabled set whenever a sibling selector
// changes (the diff-explorer uses this so Map A can never pick
// a map at-or-after Map B, and vice versa).

import { uniqueId } from "../utils/dom.js";

const SVG_NS = "http://www.w3.org/2000/svg";

// CSS-driven panel max-height (--control-panel-max-height) and
// gap (--control-panel-gap). The JS only needs these for the
// "is there room to open downwards?" decision in placePanel.
const PANEL_MAX_HEIGHT = 300;
const PANEL_GAP = 4;
const VIEWPORT_MARGIN = 8;

export function createDropdown({
    options,
    value,
    onChange,
    ariaLabel,
    ariaLabelledBy,
    size = "base",
    placeholder = "",
}) {
    const root = document.createElement("div");
    root.className = "dropdown";
    if (size === "small") root.classList.add("dropdown--small");

    const panelId = uniqueId("dropdown-panel");
    const state = {
        value,
        highlightedIdx: indexOfValue(options, value),
        open: false,
    };

    const trigger = buildTrigger({ ariaLabel, ariaLabelledBy, panelId });
    const valueEl = trigger.querySelector(".dropdown__value");
    const panel = buildPanel(panelId, ariaLabel, ariaLabelledBy);
    const optionEls = options.map((opt, idx) =>
        buildOption(opt, idx, uniqueId("dropdown-option"), opt.value === state.value),
    );
    panel.append(...optionEls);

    const isOptionDisabled = (idx) => optionEls[idx]?.classList.contains(
        "dropdown__option--disabled",
    );

    root.append(trigger, panel);

    renderValueLabel();

    // ── Internals ────────────────────────────────────────────

    function renderValueLabel() {
        const opt = options.find((o) => o.value === state.value);
        if (opt) {
            valueEl.textContent = opt.label;
            valueEl.classList.remove("dropdown__value--placeholder");
        } else {
            valueEl.textContent = placeholder;
            valueEl.classList.toggle(
                "dropdown__value--placeholder",
                Boolean(placeholder),
            );
        }
    }

    function setHighlight(idx) {
        if (idx < 0 || idx >= optionEls.length) return;
        optionEls[state.highlightedIdx]?.classList.remove("is-highlighted");
        state.highlightedIdx = idx;
        const el = optionEls[idx];
        el.classList.add("is-highlighted");
        trigger.setAttribute("aria-activedescendant", el.id);
        el.scrollIntoView({ block: "nearest" });
    }

    // Walks the option list in ``step`` direction (+1 / -1) until
    // it finds an enabled option, starting one past ``fromIdx``.
    // Returns -1 if every candidate in that direction is disabled,
    // so the caller can leave the current highlight untouched.
    function nextEnabledIdx(fromIdx, step) {
        for (let i = fromIdx + step; i >= 0 && i < optionEls.length; i += step) {
            if (!isOptionDisabled(i)) return i;
        }
        return -1;
    }

    function firstEnabledIdx() {
        return nextEnabledIdx(-1, 1);
    }

    function lastEnabledIdx() {
        return nextEnabledIdx(optionEls.length, -1);
    }

    function setOpen(next) {
        if (state.open === next) return;
        state.open = next;
        trigger.setAttribute("aria-expanded", String(next));
        panel.hidden = !next;
        root.classList.toggle("is-open", next);

        if (next) {
            // Prefer the currently selected option, but fall back
            // to the first enabled option so the highlight never
            // lands on a row the user cannot commit.
            const selectedIdx = indexOfValue(options, state.value);
            const highlightIdx =
                selectedIdx >= 0 && !isOptionDisabled(selectedIdx)
                    ? selectedIdx
                    : firstEnabledIdx();
            if (highlightIdx >= 0) setHighlight(highlightIdx);
            document.addEventListener("mousedown", handleOutsideMouseDown, true);
            document.addEventListener("touchstart", handleOutsideMouseDown, true);
            window.addEventListener("resize", placePanel);
            // Outside-scroll dismisses the panel rather than
            // re-positioning it. A panel that follows the trigger
            // through a page scroll looks like it is glued to the
            // user's cursor while the content underneath drifts
            // past, which is the opposite of the native macOS /
            // Linear / Vercel behaviour reviewers are used to.
            // Inside-scroll of the panel itself (the listbox is
            // overflow-auto) is ignored because its scroll events
            // bubble up with target === panel.
            window.addEventListener("scroll", handleOutsideScroll, true);
            placePanel();
        } else {
            trigger.removeAttribute("aria-activedescendant");
            document.removeEventListener("mousedown", handleOutsideMouseDown, true);
            document.removeEventListener("touchstart", handleOutsideMouseDown, true);
            window.removeEventListener("resize", placePanel);
            window.removeEventListener("scroll", handleOutsideScroll, true);
            panel.style.top = "";
            panel.style.bottom = "";
        }
    }

    function commit(idx) {
        const opt = options[idx];
        if (!opt || isOptionDisabled(idx)) return;
        const changed = opt.value !== state.value;
        state.value = opt.value;
        for (let i = 0; i < optionEls.length; i++) {
            optionEls[i].setAttribute("aria-selected", String(i === idx));
        }
        renderValueLabel();
        setOpen(false);
        trigger.focus();
        if (changed && onChange) onChange(state.value);
    }

    // Flip the panel up when the trigger is too close to the
    // viewport bottom for the panel to fit below. Re-checked on
    // scroll / resize so the panel never collides with the edge.
    function placePanel() {
        if (!state.open) return;
        const triggerRect = trigger.getBoundingClientRect();
        const spaceBelow =
            window.innerHeight - triggerRect.bottom - VIEWPORT_MARGIN;
        const spaceAbove = triggerRect.top - VIEWPORT_MARGIN;
        const panelHeight = Math.min(panel.scrollHeight, PANEL_MAX_HEIGHT);
        const openUp = panelHeight > spaceBelow && spaceAbove > spaceBelow;
        const offset = `calc(100% + ${PANEL_GAP}px)`;
        if (openUp) {
            panel.style.top = "auto";
            panel.style.bottom = offset;
        } else {
            panel.style.top = offset;
            panel.style.bottom = "auto";
        }
    }

    function handleOutsideMouseDown(ev) {
        if (!root.contains(ev.target)) setOpen(false);
    }

    // Scroll events from the panel's own overflow:auto bubble up
    // with target === panel (or one of its option children), so
    // the same root.contains() guard that protects outside-clicks
    // protects inside-scrolls here too. Capture-phase listener so
    // we still see scrolls from elements that stop propagation.
    function handleOutsideScroll(ev) {
        if (!root.contains(ev.target)) setOpen(false);
    }

    // ── Wire events ──────────────────────────────────────────

    trigger.addEventListener("click", () => setOpen(!state.open));
    trigger.addEventListener("keydown", handleTriggerKeydown);

    for (const el of optionEls) {
        const idx = Number(el.dataset.idx);
        // Click (not mousedown) so the outside-mousedown listener
        // does not run first and pre-close the panel. ``commit``
        // already short-circuits on disabled options, so a click
        // on a muted row reads as "nothing happened" rather than
        // as a failed selection.
        el.addEventListener("click", () => commit(idx));
        el.addEventListener("mouseenter", () => {
            // Skip the highlight transition on disabled rows so
            // they never look like the next pick.
            if (!isOptionDisabled(idx)) setHighlight(idx);
        });
    }

    function handleTriggerKeydown(ev) {
        switch (ev.key) {
            case "ArrowDown": {
                ev.preventDefault();
                if (!state.open) {
                    setOpen(true);
                } else {
                    // nextEnabledIdx returns -1 when every option
                    // below is disabled; in that case keep the
                    // current highlight so the cursor never lands
                    // on an unselectable row.
                    const nextIdx = nextEnabledIdx(state.highlightedIdx, 1);
                    if (nextIdx >= 0) setHighlight(nextIdx);
                }
                break;
            }
            case "ArrowUp": {
                ev.preventDefault();
                if (!state.open) {
                    setOpen(true);
                } else {
                    const prevIdx = nextEnabledIdx(state.highlightedIdx, -1);
                    if (prevIdx >= 0) setHighlight(prevIdx);
                }
                break;
            }
            case "Home":
                if (state.open) {
                    ev.preventDefault();
                    const firstIdx = firstEnabledIdx();
                    if (firstIdx >= 0) setHighlight(firstIdx);
                }
                break;
            case "End":
                if (state.open) {
                    ev.preventDefault();
                    const lastIdx = lastEnabledIdx();
                    if (lastIdx >= 0) setHighlight(lastIdx);
                }
                break;
            case "Enter":
            case " ":
                ev.preventDefault();
                if (!state.open) setOpen(true);
                else commit(state.highlightedIdx);
                break;
            case "Tab":
                // Close without committing so Tab feels like
                // "leave this control" rather than "pick the
                // currently highlighted option I never looked at".
                if (state.open) setOpen(false);
                break;
            case "Escape":
                if (state.open) {
                    ev.preventDefault();
                    setOpen(false);
                }
                break;
        }
    }

    // ── Public API ───────────────────────────────────────────

    root.getValue = () => state.value;
    root.setValue = (v) => {
        const idx = indexOfValue(options, v);
        if (idx < 0) return;
        state.value = v;
        for (let i = 0; i < optionEls.length; i++) {
            optionEls[i].setAttribute("aria-selected", String(i === idx));
        }
        renderValueLabel();
    };
    // Atomic disabled-set update so callers can recompute the
    // whole set in one pass per change (e.g. the diff-explorer
    // recomputes "every map at or after the other side's value"
    // when either selector fires). Accepts any iterable so a
    // Set, Array or generator all work.
    root.setDisabledValues = (values) => {
        const disabled = new Set(values);
        for (let i = 0; i < optionEls.length; i++) {
            const el = optionEls[i];
            const isDisabled = disabled.has(options[i].value);
            el.classList.toggle("dropdown__option--disabled", isDisabled);
            if (isDisabled) {
                el.setAttribute("aria-disabled", "true");
            } else {
                el.removeAttribute("aria-disabled");
            }
        }
    };

    return root;
}

// ── Element builders ────────────────────────────────────────

function buildTrigger({ ariaLabel, ariaLabelledBy, panelId }) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "dropdown__trigger";
    button.setAttribute("role", "combobox");
    button.setAttribute("aria-haspopup", "listbox");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", panelId);
    if (ariaLabel) button.setAttribute("aria-label", ariaLabel);
    if (ariaLabelledBy) button.setAttribute("aria-labelledby", ariaLabelledBy);

    const value = document.createElement("span");
    value.className = "dropdown__value";

    button.append(value, buildChevron());
    return button;
}

function buildPanel(panelId, ariaLabel, ariaLabelledBy) {
    const ul = document.createElement("ul");
    ul.className = "dropdown__panel";
    ul.id = panelId;
    ul.setAttribute("role", "listbox");
    if (ariaLabel) ul.setAttribute("aria-label", ariaLabel);
    if (ariaLabelledBy) ul.setAttribute("aria-labelledby", ariaLabelledBy);
    ul.hidden = true;
    return ul;
}

function buildOption(opt, idx, id, isSelected) {
    const li = document.createElement("li");
    li.className = "dropdown__option";
    li.id = id;
    li.dataset.idx = String(idx);
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", String(isSelected));
    li.textContent = opt.label;
    return li;
}

function buildChevron() {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "dropdown__chevron");
    svg.setAttribute("viewBox", "0 0 12 12");
    svg.setAttribute("width", "12");
    svg.setAttribute("height", "12");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", "M3 4.5L6 7.5L9 4.5");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.5");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.append(path);
    return svg;
}

function indexOfValue(options, value) {
    return options.findIndex((o) => o.value === value);
}
