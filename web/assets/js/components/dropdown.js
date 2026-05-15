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
// ariaLabelledBy, size }) returns an element exposing getValue()
// and setValue(v); setValue does NOT fire onChange (mirrors the
// native <select>.value = x semantic).

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

    root.append(trigger, panel);

    renderValueLabel();

    // ── Internals ────────────────────────────────────────────

    function renderValueLabel() {
        const opt = options.find((o) => o.value === state.value);
        valueEl.textContent = opt ? opt.label : "";
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

    function setOpen(next) {
        if (state.open === next) return;
        state.open = next;
        trigger.setAttribute("aria-expanded", String(next));
        panel.hidden = !next;
        root.classList.toggle("is-open", next);

        if (next) {
            setHighlight(Math.max(0, indexOfValue(options, state.value)));
            document.addEventListener("mousedown", handleOutsideMouseDown, true);
            document.addEventListener("touchstart", handleOutsideMouseDown, true);
            window.addEventListener("resize", placePanel);
            window.addEventListener("scroll", placePanel, true);
            placePanel();
        } else {
            trigger.removeAttribute("aria-activedescendant");
            document.removeEventListener("mousedown", handleOutsideMouseDown, true);
            document.removeEventListener("touchstart", handleOutsideMouseDown, true);
            window.removeEventListener("resize", placePanel);
            window.removeEventListener("scroll", placePanel, true);
            panel.style.top = "";
            panel.style.bottom = "";
        }
    }

    function commit(idx) {
        const opt = options[idx];
        if (!opt) return;
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

    // ── Wire events ──────────────────────────────────────────

    trigger.addEventListener("click", () => setOpen(!state.open));
    trigger.addEventListener("keydown", handleTriggerKeydown);

    for (const el of optionEls) {
        const idx = Number(el.dataset.idx);
        // Click (not mousedown) so the outside-mousedown listener
        // does not run first and pre-close the panel.
        el.addEventListener("click", () => commit(idx));
        el.addEventListener("mouseenter", () => setHighlight(idx));
    }

    function handleTriggerKeydown(ev) {
        switch (ev.key) {
            case "ArrowDown":
                ev.preventDefault();
                if (!state.open) setOpen(true);
                else setHighlight(Math.min(state.highlightedIdx + 1, options.length - 1));
                break;
            case "ArrowUp":
                ev.preventDefault();
                if (!state.open) setOpen(true);
                else setHighlight(Math.max(state.highlightedIdx - 1, 0));
                break;
            case "Home":
                if (state.open) {
                    ev.preventDefault();
                    setHighlight(0);
                }
                break;
            case "End":
                if (state.open) {
                    ev.preventDefault();
                    setHighlight(options.length - 1);
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
