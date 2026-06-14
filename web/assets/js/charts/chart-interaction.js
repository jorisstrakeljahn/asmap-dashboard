// Chart hover plumbing: pointer math, tooltip element, tooltip
// positioning. Nothing in here knows what the tooltip *says* —
// see chart-tooltip.js for the content builder.

// Hover tolerance (px) past the plot edge so a cursor or touch that
// grazes the gutter still resolves to the nearest point/bar instead
// of flickering the tooltip off. Shared by every chart's hover math
// so line and bar charts treat the gutter identically.
export const HOVER_BLEED = 12;

// Translate a (clientX, clientY) point from viewport coordinates
// into the SVG's own user-coordinate space, so hover math runs in
// the same scale the chart was drawn with.
export function clientToSvg(svgEl, clientX, clientY) {
    const pt = svgEl.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svgEl.getScreenCTM();
    if (!ctm) return null;
    return pt.matrixTransform(ctm.inverse());
}

// Wrap an SVG in a positioning container plus a tooltip element
// so charts can place their tooltip anywhere over the chart
// without worrying about stacking context. The tooltip is kept in
// the layout tree (visibility + opacity, not hidden) so its
// measured size is correct on the first frame — positionTooltip
// reads ``offsetWidth`` / ``offsetHeight`` to clamp inside the
// chart.
export function createChartShell(svgEl) {
    const shell = document.createElement("div");
    shell.className = "chart-shell";

    const tip = document.createElement("div");
    tip.className = "chart-tooltip";
    tip.setAttribute("role", "tooltip");
    tip.setAttribute("aria-hidden", "true");

    shell.append(svgEl, tip);
    return { shell, tip };
}

// Index of the data point whose X is closest to ``svgX``.
// ``xAtIndex`` translates an index into the chart's X scale so
// callers don't need to rebuild the scale here.
export function nearestIndex(svgX, count, xAtIndex) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < count; i++) {
        const dist = Math.abs(xAtIndex(i) - svgX);
        if (dist < bestDist) {
            bestDist = dist;
            bestIdx = i;
        }
    }
    return bestIdx;
}

// Show / hide the tooltip via a CSS class so the element stays in
// the layout tree and ``offsetWidth`` returns the rendered size.
export function showTooltip(tip, content) {
    tip.replaceChildren(content);
    tip.classList.add("is-visible");
    tip.setAttribute("aria-hidden", "false");
}

export function hideTooltip(tip) {
    tip.classList.remove("is-visible");
    tip.setAttribute("aria-hidden", "true");
}

export function isTooltipVisible(tip) {
    return tip.classList.contains("is-visible");
}

// Place the tooltip near the cursor and flip it to the opposite
// side whenever the preferred side would cover the cursor or clip
// the chart edge. Keeps a fixed gap between cursor and tooltip so
// the hovered data point is never visually obscured by the
// floating panel that describes it.
//
// Horizontal preference is right; flips to left when the right
// side would clip. Vertical preference is above; flips to below
// when the top would clip. The shell rectangle is the clamp
// boundary so the tooltip never spills out of the card.
const TOOLTIP_GAP = 16;
const TOOLTIP_PAD = 8;
const TOOLTIP_W_FALLBACK = 200;
const TOOLTIP_H_FALLBACK = 40;

export function positionTooltip(shell, tip, clientX, clientY) {
    const rect = shell.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const tipW = tip.offsetWidth || TOOLTIP_W_FALLBACK;
    const tipH = tip.offsetHeight || TOOLTIP_H_FALLBACK;

    // Horizontal: prefer right of cursor. Flip to left when the
    // tooltip would clip the right edge. If neither side fits
    // (very narrow viewport), park it on whichever side has more
    // room and accept the clamp.
    const rightLeft = x + TOOLTIP_GAP;
    const leftLeft = x - TOOLTIP_GAP - tipW;
    let left;
    if (rightLeft + tipW + TOOLTIP_PAD <= rect.width) {
        left = rightLeft;
    } else if (leftLeft >= TOOLTIP_PAD) {
        left = leftLeft;
    } else {
        const roomRight = rect.width - x;
        const roomLeft = x;
        left = roomRight >= roomLeft
            ? Math.max(TOOLTIP_PAD, rect.width - tipW - TOOLTIP_PAD)
            : TOOLTIP_PAD;
    }

    // Vertical: prefer above. Flip below when the top would clip;
    // clamp to the bottom edge as the last fallback so the tooltip
    // never escapes the card.
    let top = y - tipH - TOOLTIP_GAP;
    if (top < TOOLTIP_PAD) top = y + TOOLTIP_GAP;
    if (top + tipH + TOOLTIP_PAD > rect.height) {
        top = rect.height - tipH - TOOLTIP_PAD;
    }

    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
}

// Position the tooltip after two animation frames so the browser
// has settled layout for the freshly populated tooltip and
// ``offsetWidth`` reports the real rendered size. Two frames is
// belt-and-braces against subpixel layout in Safari.
export function placeTooltipNextFrame(shell, tip, clientX, clientY) {
    requestAnimationFrame(() => {
        positionTooltip(shell, tip, clientX, clientY);
        requestAnimationFrame(() =>
            positionTooltip(shell, tip, clientX, clientY),
        );
    });
}

// Touch / pen "tap and scrub" support for charts. Every chart's
// hover plumbing is mouse-only (mousemove / mouseenter), so on a
// device with no hover pointer the tooltip — the only surface that
// carries exact values, dates, and ratios — was unreachable. This
// adds that missing path without disturbing the mouse handlers.
//
// The caller wires the same show / hide it already uses for mouse:
//   resolve(clientX, clientY) -> slot index, or null when the point
//       is outside the plotted area (a tap there dismisses).
//   show(idx, clientX, clientY) -> paint + position the tooltip
//       (and any active-segment highlight) for that slot.
//   hide() -> clear the tooltip.
//
// The chart SVG sets ``touch-action: pan-y`` (see charts.css), so a
// vertical drag still scrolls the page while a horizontal drag
// scrubs the series. preventDefault only fires once a scrub is
// under way, so the page's vertical scroll is never swallowed. The
// tooltip stays put after the finger lifts (a tap reads, a second
// tap in the gutter dismisses), which matches how a reader expects
// a tapped value to behave on a touchscreen.
export function attachTouchInspect(shell, { resolve, show, hide }) {
    let scrubbing = false;
    const point = (ev) =>
        ev.touches?.[0] ?? ev.changedTouches?.[0] ?? null;

    shell.addEventListener(
        "touchstart",
        (ev) => {
            const p = point(ev);
            if (!p) return;
            const idx = resolve(p.clientX, p.clientY);
            if (idx == null) {
                hide();
                scrubbing = false;
                return;
            }
            scrubbing = true;
            show(idx, p.clientX, p.clientY);
        },
        { passive: true },
    );

    shell.addEventListener(
        "touchmove",
        (ev) => {
            if (!scrubbing) return;
            const p = point(ev);
            if (!p) return;
            const idx = resolve(p.clientX, p.clientY);
            if (idx == null) return;
            if (ev.cancelable) ev.preventDefault();
            show(idx, p.clientX, p.clientY);
        },
        { passive: false },
    );

    const end = () => {
        scrubbing = false;
    };
    shell.addEventListener("touchend", end);
    shell.addEventListener("touchcancel", end);
}

// Keyboard + screen-reader access to the same per-slot tooltip the
// mouse and touch paths surface. Every chart's values, dates, and
// ratios live only inside that floating tooltip, so without this a
// keyboard or screen-reader user has no path to the numbers at all.
//
// The caller passes the same show / hide it wires for the pointer,
// plus how to map a slot index back to an x coordinate so a synthetic
// "cursor" can be placed for that slot:
//   count           -> number of data slots (arrow navigation range).
//   show(idx, x, y)  -> paint + position the tooltip for that slot.
//   hide()           -> clear the tooltip.
//   xAt(idx)         -> the slot's x in the SVG's user space, used to
//                       project a client point for positionTooltip.
//
// The shell becomes a focusable role="application" so arrow keys
// reach this handler instead of the screen reader's browse mode, and
// a polite live region mirrors the tooltip text on each move so the
// values are spoken. Left/Right (or Up/Down) step, Home/End jump to
// the ends, Escape and blur dismiss.
export function attachKeyboardInspect(shell, { count, show, hide, xAt }) {
    if (!count || count < 1) return;

    const svgEl = shell.querySelector("svg");
    const label = svgEl?.getAttribute("aria-label");
    // Strip any trailing period so the hint reads as one clean
    // sentence rather than "series.. Use arrow keys".
    const base = label ? label.replace(/[.\s]+$/, "") : "Chart";
    shell.tabIndex = 0;
    shell.setAttribute("role", "application");
    shell.setAttribute(
        "aria-label",
        `${base}. Use arrow keys to read each data point.`,
    );

    // Polite live region: the tooltip itself is aria-hidden (it is a
    // pointer affordance), so the spoken value comes from here.
    const live = document.createElement("div");
    live.className = "chart-shell__live";
    live.setAttribute("aria-live", "polite");
    shell.append(live);

    const svgWidth = svgEl?.viewBox?.baseVal?.width || 0;
    let idx = -1;

    // Build a readable sentence from the tooltip's structured parts
    // (title, label/value rows, footer) rather than its raw
    // textContent, which would run the cells together.
    const announce = () => {
        const tip = shell.querySelector(".chart-tooltip");
        if (!tip) return;
        const parts = [];
        const title = tip.querySelector(".chart-tooltip__title");
        if (title?.textContent) parts.push(title.textContent);
        for (const kv of tip.querySelectorAll(".chart-tooltip__kv")) {
            const key = kv.querySelector("span")?.textContent ?? "";
            const value = kv.querySelector("strong")?.textContent ?? "";
            parts.push(value ? `${key}: ${value}` : key);
        }
        const footer = tip.querySelector(".chart-tooltip__muted");
        if (footer?.textContent) parts.push(footer.textContent);
        live.textContent = parts.join(". ");
    };

    // Project the slot's x into a viewport point so the existing
    // tooltip positioner can place it; y sits mid-shell since the
    // keyboard has no pointer height.
    const synthClient = (i) => {
        const rect = shell.getBoundingClientRect();
        const frac = svgWidth ? xAt(i) / svgWidth : 0.5;
        return {
            clientX: rect.left + frac * rect.width,
            clientY: rect.top + rect.height / 2,
        };
    };

    const goTo = (next) => {
        idx = Math.max(0, Math.min(count - 1, next));
        const { clientX, clientY } = synthClient(idx);
        show(idx, clientX, clientY);
        announce();
    };

    const dismiss = () => {
        idx = -1;
        hide();
        live.textContent = "";
    };

    shell.addEventListener("keydown", (ev) => {
        switch (ev.key) {
            case "ArrowRight":
            case "ArrowDown":
                goTo(idx < 0 ? 0 : idx + 1);
                ev.preventDefault();
                break;
            case "ArrowLeft":
            case "ArrowUp":
                goTo(idx < 0 ? count - 1 : idx - 1);
                ev.preventDefault();
                break;
            case "Home":
                goTo(0);
                ev.preventDefault();
                break;
            case "End":
                goTo(count - 1);
                ev.preventDefault();
                break;
            case "Escape":
                dismiss();
                break;
            default:
                break;
        }
    });
    shell.addEventListener("blur", dismiss);
}
