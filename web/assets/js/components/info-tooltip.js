// Small "i" affordance that reveals a structured explanatory
// popover on click, hover or focus. The popover sits absolutely
// beneath the trigger and flips above when the viewport edge
// would clip it, mirroring the dropdown placement pattern.
//
// Body content is an array of paragraphs. A paragraph is either
// a plain string or { lead, text } where ``lead`` is rendered
// bold so a multi-bucket explainer ("Reassigned. ...",
// "Newly Mapped. ...") reads as a labelled glossary.
//
//   createInfoTooltip({
//       ariaLabel: "About drift",
//       body: [
//           "Drift is the share of mapping entries that differ between two builds.",
//           { lead: "vs previous.", text: "Drift between consecutive builds." },
//           { lead: "vs baseline.", text: "Drift from a chosen reference build." },
//       ],
//   })
//
// The single-string ``text`` form is still accepted for the
// simple case where one sentence is enough.
//
// Returns a <span> exposing setBody(next) for late-binding copy.

import { uniqueId } from "../utils/dom.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const PANEL_GAP = 6;
const VIEWPORT_MARGIN = 8;
const PANEL_MAX_WIDTH = 320;

export function createInfoTooltip({
    text,
    body,
    ariaLabel = "More information",
} = {}) {
    const root = document.createElement("span");
    root.className = "info-tooltip";

    const popoverId = uniqueId("info-tooltip");
    const trigger = buildTrigger({ ariaLabel, popoverId });
    const popover = buildPopover(popoverId);
    renderBody(popover, body ?? text);
    root.append(trigger, popover);

    let open = false;

    function setOpen(next) {
        if (open === next) return;
        open = next;
        trigger.setAttribute("aria-expanded", String(next));
        popover.hidden = !next;
        root.classList.toggle("is-open", next);

        if (next) {
            document.addEventListener("mousedown", handleOutside, true);
            document.addEventListener("touchstart", handleOutside, true);
            document.addEventListener("keydown", handleKey, true);
            window.addEventListener("resize", placePopover);
            window.addEventListener("scroll", placePopover, true);
            // Two passes: the first reads a possibly-stale layout
            // (popover was hidden moments ago), the second rAF
            // reads the layout the browser has now committed.
            placePopover();
            requestAnimationFrame(placePopover);
        } else {
            document.removeEventListener("mousedown", handleOutside, true);
            document.removeEventListener("touchstart", handleOutside, true);
            document.removeEventListener("keydown", handleKey, true);
            window.removeEventListener("resize", placePopover);
            window.removeEventListener("scroll", placePopover, true);
            popover.style.top = "";
            popover.style.left = "";
        }
    }

    // Position the popover with `position: fixed` against the
    // viewport so any overflow:auto / overflow:hidden ancestor
    // (e.g. the Top Movers' horizontally-scrolling table) cannot
    // clip it. Flips above when the trigger is too close to the
    // viewport bottom; clamps horizontally so the popover anchors
    // to the trigger centre and stays inside the viewport.
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

    function handleOutside(ev) {
        if (!root.contains(ev.target)) setOpen(false);
    }

    function handleKey(ev) {
        if (ev.key === "Escape") {
            ev.preventDefault();
            setOpen(false);
            trigger.focus();
        }
    }

    trigger.addEventListener("click", () => setOpen(!open));
    // Hover / focus open without committing the click state, so a
    // user who tabs onto the icon sees the same hint a mouse user
    // would. The bound state is still controlled by click.
    trigger.addEventListener("mouseenter", () => setOpen(true));
    trigger.addEventListener("focus", () => setOpen(true));
    root.addEventListener("mouseleave", () => {
        // Defer so a click immediately after a hover-open does not
        // race the close. If the user clicked, ``open`` was just set
        // to false by the click handler and the deferred mouseleave
        // is a no-op.
        setTimeout(() => {
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
