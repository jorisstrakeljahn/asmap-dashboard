// "i" trigger + explanatory popover. ``body`` is an array of paragraphs
// (string or { lead, text }, ``lead`` bold) or a single ``text`` string.
// Returns a <span> with setBody(next).
//
// Same content, two presentations: a fine pointer gets an anchored
// popover next to the "i"; touch (pointer: coarse) gets a bottom-sheet
// over a scrim, since a 14px corner icon anchors poorly on a phone. The
// sheet is one shared node (only one tooltip opens at a time); see
// getInfoSheet below.

import { createOutsideDismiss } from "../utils/dismiss.js";
import { SVG_NS, uniqueId } from "../utils/dom.js";
import { t } from "../utils/i18n.js";
import { renderParagraphs } from "./paragraphs.js";

const PANEL_GAP = 6;
const VIEWPORT_MARGIN = 8;
// Wide enough that a multi-sentence explanation lays out in a few short
// lines, not a tall column. Mirrors the CSS fallback in info-tooltip.css
// and wins at runtime, so it must track the stylesheet; placePopover caps
// it to the viewport on narrow screens.
const PANEL_MAX_WIDTH = 480;

// Primary pointer is touch -> render the sheet instead of the popover.
const coarsePointer = window.matchMedia("(pointer: coarse)");

// ``sheetHeader`` (optional) returns a Node or array of Nodes shown above
// a divider in the bottom-sheet, leading the explanation with the host
// card's title / number / description so a phone reader keeps the context
// desktop gets from the adjacent popover. Ignored in the popover.
export function createInfoTooltip({ text, body, ariaLabel, sheetHeader } = {}) {
    const root = document.createElement("span");
    root.className = "info-tooltip";

    const popoverId = uniqueId("info-tooltip");
    const trigger = buildTrigger({
        ariaLabel: ariaLabel ?? t("infoTooltip.defaultAria"),
        popoverId,
    });
    const popover = buildPopover(popoverId);
    // Track live content so the shared bottom-sheet renders the same
    // paragraphs as the popover, including later setBody updates.
    let currentBody = body ?? text;
    renderParagraphs(popover, currentBody);
    root.append(trigger, popover);

    const sheetAriaLabel = ariaLabel ?? t("infoTooltip.defaultAria");

    // Two-stage open / close model:
    //
    //   open   — panel is currently visible (hover or click)
    //   sticky — committed via click; mouseleave does not auto-close
    //
    // The "click toggles open" pattern fights hover-preview (a
    // click on an already-hovered icon would close it again), so
    // sticky is a third state, not a toggle.
    //
    // ``mode`` records the presentation an open used so the matching
    // close path runs even if the pointer type changed mid-open.
    let open = false;
    let sticky = false;
    let mode = null;

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
    // The popover never scrolls internally, so every scroll dismisses.
    // (Sheet mode wires its own dismissals; this is the popover path.)
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
            mode = coarsePointer.matches ? "sheet" : "popover";
            if (mode === "sheet") openSheet();
            else openPopover();
        } else {
            if (mode === "sheet") closeSheet();
            else closePopover();
            mode = null;
            sticky = false;
            warmUntil = Date.now() + HOVER_WARM_WINDOW_MS;
        }
    }

    function openPopover() {
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
    }

    function closePopover() {
        dismiss.detach();
        document.removeEventListener("keydown", handleKey, true);
        // Collapse back toward the icon, then hide once the
        // transition has had time to run.
        popover.classList.add("is-collapsed");
        if (closeTimer) clearTimeout(closeTimer);
        closeTimer = setTimeout(finishClose, CLOSE_MS);
    }

    function openSheet() {
        getInfoSheet().open(currentBody, {
            ariaLabel: sheetAriaLabel,
            header: sheetHeader,
            onRequestClose: () => setOpen(false),
        });
    }

    function closeSheet() {
        getInfoSheet().close();
        // Return focus to the trigger for keyboard / switch users. Hover
        // + focus opens are gated on a fine pointer, so this never re-opens
        // the sheet on touch.
        trigger.focus({ preventScroll: true });
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
        popover.style.maxHeight = "";
        popover.style.transformOrigin = "";
        popover.style.removeProperty("--tip-enter-shift");
    }

    // position:fixed against the viewport so overflow:auto
    // ancestors (the top-movers scroll container) cannot clip.
    function placePopover() {
        if (!open || mode !== "popover") return;
        const triggerRect = trigger.getBoundingClientRect();
        // Measure the document client box, NOT window.innerWidth/Height:
        // those include the scrollbar gutter, so a panel at the "edge"
        // slides under the scrollbar and clips. clientWidth/Height is the
        // usable content area.
        const viewportWidth = document.documentElement.clientWidth;
        const viewportHeight = document.documentElement.clientHeight;
        // Cap the panel to the usable viewport *before* measuring it, so
        // a narrow window shrinks the panel (and scrolls it internally
        // when tall) instead of letting it overflow the screen edge.
        popover.style.maxWidth = `${Math.min(PANEL_MAX_WIDTH, viewportWidth - 2 * VIEWPORT_MARGIN)}px`;
        popover.style.maxHeight = `${viewportHeight - 2 * VIEWPORT_MARGIN}px`;
        // offset* is the untransformed layout size; the open/close
        // scale on the panel must not skew the placement maths.
        const popoverWidth = popover.offsetWidth;
        const popoverHeight = popover.offsetHeight;
        const spaceBelow = viewportHeight - triggerRect.bottom - VIEWPORT_MARGIN;
        const spaceAbove = triggerRect.top - VIEWPORT_MARGIN;
        const openUp = popoverHeight > spaceBelow && spaceAbove > spaceBelow;
        if (openUp) {
            popover.style.top = `${Math.max(VIEWPORT_MARGIN, triggerRect.top - PANEL_GAP - popoverHeight)}px`;
        } else {
            popover.style.top = `${triggerRect.bottom + PANEL_GAP}px`;
        }

        const triggerCentre = triggerRect.left + triggerRect.width / 2;
        const minLeft = VIEWPORT_MARGIN;
        const maxLeft = viewportWidth - VIEWPORT_MARGIN - popoverWidth;
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
    // Skipped on touch, where the sheet opens on tap (click) only.
    trigger.addEventListener("mouseenter", () => {
        if (coarsePointer.matches) return;
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
    // a tabbing user sees the hint instantly. On touch the focus that
    // follows a tap must not open the sheet (the click handler owns
    // that), and must not re-open it when focus returns on close.
    trigger.addEventListener("focus", () => {
        if (coarsePointer.matches) return;
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
        currentBody = next;
        renderParagraphs(popover, next);
    };
    return root;
}

// Snapshot a container's content for the sheet header: every child bar
// the info trigger, cloned (live DOM untouched) with nested triggers
// stripped (a dead "i" only confuses) and ids dropped (the sheet copy
// must not duplicate an id still live in the card). Read at open time, so
// it tracks the current build. Callers pass the element whose numbers
// frame the explanation — a card, or a smaller wrap like the node-impact
// banner.
//
// ``exclude`` lists selectors to leave out, used where a card hosts
// sub-sections with their own "i" (roster-delta line, node-impact
// banner): the card explainer then covers the headline breakdown only.
export function cloneSheetContext(container, { exclude = [] } = {}) {
    const nodes = [];
    for (const child of container.children) {
        if (child.classList.contains("info-tooltip")) continue;
        if (exclude.some((selector) => child.matches(selector))) continue;
        const clone = child.cloneNode(true);
        clone.querySelectorAll?.(".info-tooltip").forEach((node) => node.remove());
        clone.removeAttribute?.("id");
        clone.querySelectorAll?.("[id]").forEach((node) => node.removeAttribute("id"));
        nodes.push(clone);
    }
    return nodes;
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
    // Cap to the viewport so the panel never outgrows the screen and
    // clips; placePopover only moves it. Mirrors info-tooltip.css.
    div.style.maxWidth = `min(${PANEL_MAX_WIDTH}px, calc(100vw - ${2 * VIEWPORT_MARGIN}px))`;
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

// ── Shared mobile bottom-sheet ───────────────────────────────────
// One node for the whole page (only one tooltip opens at a time), built
// lazily on the first touch open. The open tooltip registers an
// ``onRequestClose`` so any dismissal (scrim, swipe, Escape, pointer-type
// change) routes back through its setOpen(false) — the one close path
// that also restores focus.
let infoSheet = null;

function getInfoSheet() {
    if (!infoSheet) infoSheet = createInfoSheet();
    return infoSheet;
}

function createInfoSheet() {
    // Must outlast --motion-sheet (340ms) so the slide-down finishes
    // before the sheet is hidden.
    const SHEET_CLOSE_MS = 360;
    // Drag past this fraction of the sheet height, or flick faster than
    // this velocity (px/ms), to dismiss on release.
    const DRAG_DISMISS_RATIO = 0.3;
    const DRAG_FLICK_VELOCITY = 0.6;

    const backdrop = document.createElement("div");
    backdrop.className = "info-sheet-backdrop";
    backdrop.hidden = true;

    const sheet = document.createElement("div");
    sheet.className = "info-sheet";
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    // No on-screen close control (swipe, scrim or Escape dismiss), so the
    // dialog takes focus on open and is the lone Tab stop. tabindex -1
    // keeps it focusable without joining the tab order.
    sheet.tabIndex = -1;

    const grip = document.createElement("div");
    grip.className = "info-sheet__grip";
    grip.setAttribute("aria-hidden", "true");
    const handle = document.createElement("span");
    handle.className = "info-sheet__handle";
    grip.append(handle);

    // One scroll region for the (optional) header, divider and explanation,
    // so the stack scrolls as a unit while the grip stays put.
    const scrollEl = document.createElement("div");
    scrollEl.className = "info-sheet__scroll";

    const headerEl = document.createElement("div");
    headerEl.className = "info-sheet__card";
    headerEl.hidden = true;

    const divider = document.createElement("hr");
    divider.className = "info-sheet__divider";
    divider.hidden = true;

    const bodyEl = document.createElement("div");
    bodyEl.className = "info-sheet__body";

    scrollEl.append(headerEl, divider, bodyEl);
    sheet.append(grip, scrollEl);
    backdrop.append(sheet);
    document.body.append(backdrop);

    let active = null;
    let hideTimer = 0;

    function requestClose() {
        if (active) active.onRequestClose();
    }

    // Edge scroll-fades: fade an edge only while content runs past it,
    // drop it once that end is in view (first / last line never dimmed).
    // 1px slack absorbs sub-pixel rounding so the fades don't flicker.
    function updateScrollFade() {
        const overflowing = scrollEl.scrollHeight - scrollEl.clientHeight > 1;
        const atTop = scrollEl.scrollTop <= 1;
        const atBottom =
            scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 1;
        scrollEl.classList.toggle("is-overflowing", overflowing);
        scrollEl.classList.toggle("is-at-top", atTop);
        scrollEl.classList.toggle("is-at-bottom", atBottom);
    }
    scrollEl.addEventListener("scroll", updateScrollFade, { passive: true });
    // Orientation / chrome changes resize the sheet while it is open;
    // re-measure so the fade tracks the new fold.
    window.addEventListener("resize", () => {
        if (active) updateScrollFade();
    });

    function open(bodyInput, { ariaLabel, header, onRequestClose }) {
        active = { onRequestClose };
        if (hideTimer) {
            clearTimeout(hideTimer);
            hideTimer = 0;
        }
        renderParagraphs(bodyEl, bodyInput);
        // Lead with the host card's content when the caller supplies it,
        // divided from the explanation; empty otherwise.
        headerEl.replaceChildren();
        const headerNodes = typeof header === "function" ? header() : null;
        const hasHeader = headerNodes && [].concat(headerNodes).length > 0;
        if (hasHeader) headerEl.append(...[].concat(headerNodes));
        headerEl.hidden = !hasHeader;
        divider.hidden = !hasHeader;
        // Label the dialog with the tooltip's own description.
        sheet.setAttribute("aria-label", ariaLabel);
        sheet.classList.remove("is-dragging");
        sheet.style.transform = "";
        scrollEl.scrollTop = 0;
        backdrop.hidden = false;
        // Paint the off-screen state, then drop the class next frame so
        // the scrim fades and the sheet slides up.
        backdrop.classList.add("is-collapsed");
        document.body.classList.add("has-info-sheet-open");
        document.addEventListener("keydown", onKey, true);
        requestAnimationFrame(() => {
            backdrop.classList.remove("is-collapsed");
            // Measure after layout settles so scrollHeight reflects the
            // freshly-rendered header + body.
            updateScrollFade();
        });
        sheet.focus({ preventScroll: true });
    }

    function close() {
        if (!active) return;
        active = null;
        document.removeEventListener("keydown", onKey, true);
        document.body.classList.remove("has-info-sheet-open");
        sheet.classList.remove("is-dragging");
        // Set the collapsed target first, then drop the drag offset so the
        // sheet glides from where the finger left it to off-screen instead
        // of snapping.
        backdrop.classList.add("is-collapsed");
        sheet.style.transform = "";
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
            hideTimer = 0;
            backdrop.hidden = true;
        }, SHEET_CLOSE_MS);
    }

    function onKey(ev) {
        if (ev.key === "Escape") {
            ev.preventDefault();
            requestClose();
        } else if (ev.key === "Tab") {
            // Bodies are non-interactive and there's no close button, so
            // the dialog is the only focus target: trap focus on it.
            ev.preventDefault();
            sheet.focus();
        }
    }

    backdrop.addEventListener("click", (ev) => {
        // Scrim tap only — a click that bubbled up from the sheet body
        // keeps it open.
        if (ev.target === backdrop) requestClose();
    });

    // Swipe-down to dismiss: drag from the grip strip, track the finger
    // with an inline transform, then dismiss past a threshold / flick
    // or spring back to rest.
    let dragging = false;
    let dragStartY = 0;
    let dragDelta = 0;
    let dragStartTime = 0;

    grip.addEventListener("pointerdown", (ev) => {
        dragging = true;
        dragStartY = ev.clientY;
        dragDelta = 0;
        dragStartTime = ev.timeStamp;
        sheet.classList.add("is-dragging");
        grip.setPointerCapture(ev.pointerId);
    });
    grip.addEventListener("pointermove", (ev) => {
        if (!dragging) return;
        // Downward only; an upward over-pull rests at the top edge.
        dragDelta = Math.max(0, ev.clientY - dragStartY);
        sheet.style.transform = `translateY(${dragDelta}px)`;
    });
    function endDrag(ev) {
        if (!dragging) return;
        dragging = false;
        sheet.classList.remove("is-dragging");
        const height = sheet.offsetHeight || 1;
        const elapsed = Math.max(ev.timeStamp - dragStartTime, 1);
        const velocity = dragDelta / elapsed;
        if (dragDelta > height * DRAG_DISMISS_RATIO || velocity > DRAG_FLICK_VELOCITY) {
            requestClose();
        } else {
            sheet.style.transform = "";
        }
    }
    grip.addEventListener("pointerup", endDrag);
    grip.addEventListener("pointercancel", endDrag);

    // Primary pointer flips to fine (e.g. a tablet gains a mouse) while
    // the sheet is open: dismiss it so the next open uses the popover.
    coarsePointer.addEventListener("change", (ev) => {
        if (!ev.matches && active) requestClose();
    });

    return { open, close };
}
