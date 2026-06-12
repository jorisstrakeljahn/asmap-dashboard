// "i" trigger + explanatory popover. ``body`` is an array of
// paragraphs; a paragraph is either a string or { lead, text }
// where ``lead`` renders bold so multi-bucket explainers read
// as a glossary. Single-string ``text`` is accepted for the
// simple case. Returns a <span> exposing setBody(next).

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
    //   sticky — committed via click; mouseleave no longer auto-closes
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
        popover.hidden = !next;
        root.classList.toggle("is-open", next);

        if (next) {
            dismiss.attach();
            // Escape-to-close is unique to the tooltip (the dropdown
            // handles Escape on its trigger keydown), so it stays here.
            document.addEventListener("keydown", handleKey, true);
            // Two passes: the first reads a stale layout, the
            // rAF reads the committed layout.
            placePopover();
            requestAnimationFrame(placePopover);
        } else {
            sticky = false;
            warmUntil = Date.now() + HOVER_WARM_WINDOW_MS;
            dismiss.detach();
            document.removeEventListener("keydown", handleKey, true);
            popover.style.top = "";
            popover.style.left = "";
        }
    }

    // position:fixed against the viewport so overflow:auto
    // ancestors (the top-movers scroll container) cannot clip.
    function placePopover() {
        if (!open) return;
        const triggerRect = trigger.getBoundingClientRect();
        const popoverRect = popover.getBoundingClientRect();
        const spaceBelow = window.innerHeight - triggerRect.bottom - VIEWPORT_MARGIN;
        const spaceAbove = triggerRect.top - VIEWPORT_MARGIN;
        const popoverHeight = popoverRect.height;
        const openUp = popoverHeight > spaceBelow && spaceAbove > spaceBelow;
        if (openUp) {
            popover.style.top = `${triggerRect.top - PANEL_GAP - popoverHeight}px`;
        } else {
            popover.style.top = `${triggerRect.bottom + PANEL_GAP}px`;
        }

        const triggerCentre = triggerRect.left + triggerRect.width / 2;
        const minLeft = VIEWPORT_MARGIN;
        const maxLeft =
            window.innerWidth - VIEWPORT_MARGIN - popoverRect.width;
        const clamped = Math.min(
            Math.max(triggerCentre - popoverRect.width / 2, minLeft),
            Math.max(maxLeft, minLeft),
        );
        popover.style.left = `${clamped}px`;
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
            // Open via hover -> pin in place. Without this branch
            // the click would toggle the popover closed, which is
            // exactly the bug the sticky state exists to prevent.
            sticky = true;
        } else {
            // Already pinned -> the click dismisses it.
            setOpen(false);
        }
    });
    // Hover-intent open. A passing mouse triggers a 180 ms timer
    // that resolves only if the mouse is still on the icon when
    // it fires. Within the warm window (set by the previous
    // close) the timer is skipped entirely, so a user who just
    // closed the popover and immediately re-hovers sees it open
    // instantly. Already sticky => already open, nothing to do.
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
        // Defer so a click immediately after a hover-open does not
        // race the close. If the user clicked, ``open`` was just set
        // by the click handler and the deferred mouseleave is a
        // no-op when sticky is true.
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

// Coerce ``input`` into an array of paragraph descriptors and
// paint them into the popover. Single strings become one
// paragraph; arrays may mix plain strings and {lead, text}
// objects so a tooltip can read as a short paragraph followed
// by a labelled glossary.
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
