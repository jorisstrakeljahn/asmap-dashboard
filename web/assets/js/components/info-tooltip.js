// "i" trigger + explanatory popover. ``body`` is an array of
// paragraphs, each a string or { lead, text } where ``lead`` renders
// bold so multi-bucket explainers read as a glossary. A single
// ``text`` string is also accepted. Returns a <span> with setBody(next).

import { createOutsideDismiss } from "../utils/dismiss.js";
import { SVG_NS, uniqueId } from "../utils/dom.js";
import { t } from "../utils/i18n.js";

const PANEL_GAP = 6;
const VIEWPORT_MARGIN = 8;
const PANEL_MAX_WIDTH = 400;

export function createInfoTooltip({ text, body, ariaLabel } = {}) {
    const root = document.createElement("span");
    root.className = "info-tooltip";

    const popoverId = uniqueId("info-tooltip");
    const trigger = buildTrigger({
        ariaLabel: ariaLabel ?? t("infoTooltip.defaultAria"),
        popoverId,
    });
    const popover = buildPopover(popoverId);
    renderBody(popover, body ?? text);
    root.append(trigger, popover);

    // Two-stage open / close model:
    //
    //   open   — popover is currently visible (hover or click)
    //   sticky — committed via click; mouseleave does not auto-close
    //
    // The "click toggles open" pattern fights hover-preview (a
    // click on an already-hovered icon would close it again), so
    // sticky is a third state, not a toggle.
    let open = false;
    let sticky = false;

    // 180 ms cold-open delay swallows mice that only pass over the
    // icon; 320 ms warm window after close lets a re-hover open
    // instantly. Focus + click bypass both as explicit intent.
    const HOVER_OPEN_DELAY_MS = 180;
    const HOVER_WARM_WINDOW_MS = 320;
    let hoverOpenTimer = 0;
    let warmUntil = 0;

    // Keep the panel in the DOM until the collapse transition
    // finishes, then hide it. Matches --motion-slow in tokens.css;
    // under reduced-motion the transition is ~instant and this timer
    // just hides the already-invisible panel.
    const CLOSE_MS = 160;
    let closeTimer = 0;

    function cancelPendingOpen() {
        if (hoverOpenTimer) {
            clearTimeout(hoverOpenTimer);
            hoverOpenTimer = 0;
        }
    }

    // Outside press / scroll closes the popover; resize re-places it.
    // The popover is short enough never to need internal scrolling, so
    // every scroll is an outside-scroll that dismisses.
    const dismiss = createOutsideDismiss({
        root,
        onDismiss: () => setOpen(false),
        reposition: placePopover,
    });

    function setOpen(next) {
        if (open === next) return;
        open = next;
        trigger.setAttribute("aria-expanded", String(next));
        root.classList.toggle("is-open", next);

        if (next) {
            // A close transition may still be running; cancel its
            // pending hide so the panel re-opens from wherever it is.
            if (closeTimer) {
                clearTimeout(closeTimer);
                closeTimer = 0;
            }
            popover.hidden = false;
            // Paint the collapsed state first, place the panel (which
            // also reads layout, flushing that state), then drop the
            // class on the next frame so the scale+fade animates open.
            popover.classList.add("is-collapsed");
            dismiss.attach();
            // Escape-to-close is unique to the tooltip (the dropdown
            // handles Escape on its trigger keydown), so it stays here.
            document.addEventListener("keydown", handleKey, true);
            placePopover();
            requestAnimationFrame(() => {
                placePopover();
                popover.classList.remove("is-collapsed");
            });
        } else {
            sticky = false;
            warmUntil = Date.now() + HOVER_WARM_WINDOW_MS;
            dismiss.detach();
            document.removeEventListener("keydown", handleKey, true);
            // Collapse back toward the icon, then hide once the
            // transition has had time to run.
            popover.classList.add("is-collapsed");
            if (closeTimer) clearTimeout(closeTimer);
            closeTimer = setTimeout(finishClose, CLOSE_MS);
        }
    }

    // Final teardown after the collapse transition: pull the panel out
    // of the layout and reset the inline placement so the next open
    // starts clean. Bailed if a re-open beat the timer.
    function finishClose() {
        closeTimer = 0;
        if (open) return;
        popover.hidden = true;
        popover.classList.remove("is-collapsed");
        popover.style.top = "";
        popover.style.left = "";
        popover.style.transformOrigin = "";
        popover.style.removeProperty("--tip-enter-shift");
    }

    // position:fixed against the viewport so overflow:auto
    // ancestors (the top-movers scroll container) cannot clip.
    function placePopover() {
        if (!open) return;
        const triggerRect = trigger.getBoundingClientRect();
        // offset* is the untransformed layout size; the open/close
        // scale on the panel must not skew the placement maths.
        const popoverWidth = popover.offsetWidth;
        const popoverHeight = popover.offsetHeight;
        const spaceBelow = window.innerHeight - triggerRect.bottom - VIEWPORT_MARGIN;
        const spaceAbove = triggerRect.top - VIEWPORT_MARGIN;
        const openUp = popoverHeight > spaceBelow && spaceAbove > spaceBelow;
        if (openUp) {
            popover.style.top = `${triggerRect.top - PANEL_GAP - popoverHeight}px`;
        } else {
            popover.style.top = `${triggerRect.bottom + PANEL_GAP}px`;
        }

        const triggerCentre = triggerRect.left + triggerRect.width / 2;
        const minLeft = VIEWPORT_MARGIN;
        const maxLeft =
            window.innerWidth - VIEWPORT_MARGIN - popoverWidth;
        const clamped = Math.min(
            Math.max(triggerCentre - popoverWidth / 2, minLeft),
            Math.max(maxLeft, minLeft),
        );
        popover.style.left = `${clamped}px`;

        // Anchor the open/close scale to the icon: origin x tracks the
        // trigger centre even when the panel is clamped to the viewport
        // edge, and the vertical edge + enter shift flip when the panel
        // opens upward so it always grows out of (and back into) the "i".
        const originX = triggerCentre - clamped;
        popover.style.transformOrigin = `${originX}px ${openUp ? "bottom" : "top"}`;
        popover.style.setProperty("--tip-enter-shift", openUp ? "4px" : "-4px");
    }

    function handleKey(ev) {
        if (ev.key === "Escape") {
            ev.preventDefault();
            setOpen(false);
            trigger.focus();
        }
    }

    trigger.addEventListener("click", () => {
        // Click is unambiguous intent: cancel any pending cold
        // open so the popover never re-opens half a second after
        // the user already dismissed it with the same click.
        cancelPendingOpen();
        if (!open) {
            // Closed -> open and immediately pin so mouseleave
            // does not close what the click just asked for.
            sticky = true;
            setOpen(true);
        } else if (!sticky) {
            // Open via hover -> pin in place. Without this the click
            // would toggle it closed (the bug sticky prevents).
            sticky = true;
        } else {
            // Already pinned -> the click dismisses it.
            setOpen(false);
        }
    });
    // Hover-intent open: a passing mouse arms a 180 ms timer that
    // resolves only if still on the icon. Within the warm window the
    // timer is skipped so a re-hover after close opens instantly.
    trigger.addEventListener("mouseenter", () => {
        if (sticky || open) return;
        if (Date.now() < warmUntil) {
            setOpen(true);
        } else {
            cancelPendingOpen();
            hoverOpenTimer = setTimeout(() => {
                hoverOpenTimer = 0;
                if (!sticky) setOpen(true);
            }, HOVER_OPEN_DELAY_MS);
        }
    });
    // Keyboard focus is intentional - skip the cold-open delay so
    // a tabbing user sees the hint instantly.
    trigger.addEventListener("focus", () => {
        cancelPendingOpen();
        if (!sticky) setOpen(true);
    });
    // Mouse leaves before the cold-open timer fires: cancel the
    // pending open so a drag-by mouse never lights the popover.
    trigger.addEventListener("mouseleave", () => {
        cancelPendingOpen();
    });
    root.addEventListener("mouseleave", () => {
        cancelPendingOpen();
        // While pinned the popover must survive the mouseleave;
        // only the next click, outside-click or ESC dismisses it.
        if (sticky) return;
        // Defer so a click right after a hover-open does not race the
        // close: if the user clicked, sticky is set and this no-ops.
        setTimeout(() => {
            if (sticky) return;
            if (!root.matches(":hover") && document.activeElement !== trigger) {
                setOpen(false);
            }
        }, 0);
    });

    root.setBody = (next) => {
        renderBody(popover, next);
    };
    return root;
}

// Coerce ``input`` into an array of paragraph descriptors and paint
// them into the popover. A single string becomes one paragraph;
// arrays may mix strings and {lead, text} objects.
function renderBody(popover, input) {
    popover.replaceChildren();
    if (!input) return;
    const paragraphs = Array.isArray(input) ? input : [input];
    for (const paragraph of paragraphs) {
        const p = document.createElement("p");
        p.className = "info-tooltip__paragraph";
        if (typeof paragraph === "string") {
            p.textContent = paragraph;
        } else if (paragraph && typeof paragraph === "object") {
            const { lead, text } = paragraph;
            if (lead) {
                const strong = document.createElement("strong");
                strong.className = "info-tooltip__lead";
                strong.textContent = lead;
                p.append(strong, " ");
            }
            if (text) p.append(text);
        }
        popover.append(p);
    }
}

function buildTrigger({ ariaLabel, popoverId }) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "info-tooltip__trigger";
    button.setAttribute("aria-label", ariaLabel);
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", popoverId);
    button.append(buildIcon());
    return button;
}

function buildPopover(id) {
    const div = document.createElement("div");
    div.className = "info-tooltip__popover";
    div.id = id;
    div.setAttribute("role", "tooltip");
    div.style.maxWidth = `${PANEL_MAX_WIDTH}px`;
    div.hidden = true;
    return div;
}

function buildIcon() {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "info-tooltip__icon");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", "14");
    svg.setAttribute("height", "14");
    svg.setAttribute("aria-hidden", "true");
    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("cx", "8");
    circle.setAttribute("cy", "8");
    circle.setAttribute("r", "7");
    circle.setAttribute("fill", "none");
    circle.setAttribute("stroke", "currentColor");
    circle.setAttribute("stroke-width", "1.4");
    const dot = document.createElementNS(SVG_NS, "circle");
    dot.setAttribute("cx", "8");
    dot.setAttribute("cy", "5");
    dot.setAttribute("r", "0.9");
    dot.setAttribute("fill", "currentColor");
    const stem = document.createElementNS(SVG_NS, "path");
    stem.setAttribute("d", "M8 7.5V11.5");
    stem.setAttribute("stroke", "currentColor");
    stem.setAttribute("stroke-width", "1.4");
    stem.setAttribute("stroke-linecap", "round");
    svg.append(circle, dot, stem);
    return svg;
}
