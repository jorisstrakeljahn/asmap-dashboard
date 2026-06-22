// Custom combobox replacing every native <select> on the dashboard:
// native popovers are OS-controlled and show their own picker sheet
// on mobile, breaking the visual language. Wires the WAI-ARIA 1.2
// collapsible combobox pattern:
// https://www.w3.org/WAI/ARIA/apg/patterns/combobox/
//
// createDropdown({ options, value, onChange, ariaLabel |
// ariaLabelledBy, size, placeholder }) returns an element exposing
// getValue(), setValue(v) and setDisabledValues(values). setValue
// does NOT fire onChange (mirrors <select>.value = x). ``placeholder``
// is shown when ``value`` is null / unknown.
//
// Options may carry ``disabled: true``: rendered muted, click / Enter
// / Space no-op and arrows skip over them. setDisabledValues(values)
// takes any iterable so callers can re-derive the disabled set when a
// sibling selector changes (diff-explorer: Map A can never pick a map
// at-or-after Map B, and vice versa).

import { createOutsideDismiss } from "../utils/dismiss.js";
import { SVG_NS, uniqueId } from "../utils/dom.js";

// CSS-driven panel max-height (--control-panel-max-height) and
// gap (--control-panel-gap). The JS only needs these for the
// "is there room to open downwards?" decision in placePanel.
const PANEL_MAX_HEIGHT = 300;
const PANEL_GAP = 4;
const VIEWPORT_MARGIN = 8;
// Matches --motion-pill in tokens.css: how long the open/close
// grid-rows reveal runs, so the panel is pulled from the DOM only once
// the collapse has finished playing.
const CLOSE_MS = 220;

const reducedMotionQuery =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;

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
    const { panel, list } = buildPanel(panelId, ariaLabel, ariaLabelledBy);
    // The non-scrolling clip layer that hosts the edge-fade overlays.
    const inner = panel.querySelector(".dropdown__panel-inner");
    const optionEls = options.map((opt, idx) =>
        buildOption(opt, idx, uniqueId("dropdown-option"), opt.value === state.value),
    );
    list.append(...optionEls);

    const isOptionDisabled = (idx) => optionEls[idx]?.classList.contains(
        "dropdown__option--disabled",
    );

    root.append(trigger, panel);

    renderValueLabel();

    // Outside press / scroll closes the panel; resize re-places it.
    // Scroll dismisses rather than re-positioning: a panel that
    // follows the trigger through a page scroll looks glued to the
    // cursor while content drifts past. Inside-scroll of the panel's
    // own listbox bubbles up with target === panel, so the
    // root.contains() guard protects it.
    const dismiss = createOutsideDismiss({
        root,
        onDismiss: () => setOpen(false),
        reposition: placePanel,
    });

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

    // Fade an edge only while options run past it (and drop the fade
    // once that end is in view), so the last/first row is never dimmed.
    // 1px slack absorbs sub-pixel rounding.
    function updateScrollFade() {
        const overflowing = list.scrollHeight - list.clientHeight > 1;
        const atTop = list.scrollTop <= 1;
        const atBottom =
            list.scrollTop + list.clientHeight >= list.scrollHeight - 1;
        inner.classList.toggle("has-fade-top", overflowing && !atTop);
        inner.classList.toggle("has-fade-bottom", overflowing && !atBottom);
    }
    list.addEventListener("scroll", updateScrollFade, { passive: true });

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

    let closeTimer = 0;

    function setOpen(next) {
        if (state.open === next) return;
        state.open = next;
        trigger.setAttribute("aria-expanded", String(next));

        const motionOk = !(reducedMotionQuery && reducedMotionQuery.matches);

        if (next) {
            // A close transition may still be collapsing the panel;
            // cancel its pending hide so it re-opens from where it is.
            if (closeTimer) {
                window.clearTimeout(closeTimer);
                closeTimer = 0;
            }
            // Show it collapsed (is-open still off → grid-rows 0fr),
            // place + highlight, then flip is-open on the next frame so
            // the 0fr→1fr reveal actually animates instead of snapping.
            panel.hidden = false;
            // Prefer the currently selected option, but fall back
            // to the first enabled option so the highlight never
            // lands on a row the user cannot commit.
            const selectedIdx = indexOfValue(options, state.value);
            const highlightIdx =
                selectedIdx >= 0 && !isOptionDisabled(selectedIdx)
                    ? selectedIdx
                    : firstEnabledIdx();
            if (highlightIdx >= 0) setHighlight(highlightIdx);
            dismiss.attach();
            placePanel();
            updateScrollFade();
            if (motionOk) {
                // Flush the collapsed frame, then open next frame.
                void panel.offsetHeight;
                requestAnimationFrame(() => {
                    if (state.open) root.classList.add("is-open");
                    // Re-measure once the listbox has its open height.
                    updateScrollFade();
                });
            } else {
                root.classList.add("is-open");
            }
        } else {
            root.classList.remove("is-open");
            trigger.removeAttribute("aria-activedescendant");
            dismiss.detach();
            // Keep the panel in the DOM through the collapse, then pull
            // it out once the reveal has played back to 0fr.
            if (closeTimer) window.clearTimeout(closeTimer);
            if (motionOk) {
                closeTimer = window.setTimeout(finishClose, CLOSE_MS);
            } else {
                finishClose();
            }
        }
    }

    // Final teardown after the collapse: hide the panel and reset the
    // inline placement so the next open starts clean. Bailed if a
    // re-open beat the timer.
    function finishClose() {
        closeTimer = 0;
        if (state.open) return;
        panel.hidden = true;
        panel.style.top = "";
        panel.style.bottom = "";
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
        // Measure the listbox's natural content height, not the panel:
        // the panel is collapsed (grid-rows 0fr) at decision time, so
        // its own box is ~0 tall.
        const panelHeight = Math.min(list.scrollHeight, PANEL_MAX_HEIGHT);
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

    // ── Wire events ──────────────────────────────────────────

    trigger.addEventListener("click", () => setOpen(!state.open));
    trigger.addEventListener("keydown", handleTriggerKeydown);

    for (const el of optionEls) {
        const idx = Number(el.dataset.idx);
        // Click (not mousedown) so the outside-mousedown listener
        // doesn't pre-close the panel first. ``commit`` short-circuits
        // on disabled options, so a click on a muted row no-ops.
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
                    // below is disabled; keep the current highlight
                    // so the cursor never lands on an unselectable row.
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
                // Close without committing so Tab leaves the control
                // rather than picking the highlighted option.
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
    // Atomic disabled-set update: callers recompute the whole set in
    // one pass per change. Accepts any iterable.
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

// Three nested layers so the open/close reveal stays clean: the
// positioned ``panel`` runs the grid-rows tween, ``inner`` clips the
// overflow and carries the surface + blur fade, and the ``ul`` is the
// scrollable listbox. Returns the panel (mounted) and the list (for the
// options + listbox semantics).
function buildPanel(panelId, ariaLabel, ariaLabelledBy) {
    const panel = document.createElement("div");
    panel.className = "dropdown__panel";
    panel.hidden = true;

    const inner = document.createElement("div");
    inner.className = "dropdown__panel-inner";

    const ul = document.createElement("ul");
    ul.className = "dropdown__list";
    ul.id = panelId;
    ul.setAttribute("role", "listbox");
    if (ariaLabel) ul.setAttribute("aria-label", ariaLabel);
    if (ariaLabelledBy) ul.setAttribute("aria-labelledby", ariaLabelledBy);

    inner.append(ul);
    panel.append(inner);
    return { panel, list: ul };
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
