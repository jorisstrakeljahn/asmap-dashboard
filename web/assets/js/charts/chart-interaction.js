// Chart hover plumbing: pointer math, tooltip element, tooltip positioning.
// Nothing in here knows what the tooltip *says* - see chart-tooltip.js for the
// content builder.

// Hover tolerance (px) past the plot edge so a cursor grazing the gutter still
// resolves to the nearest point/bar instead of flickering off. Shared so line
// and bar charts treat the gutter identically.
export const HOVER_BLEED = 12;

// Viewport (clientX, clientY) -> the SVG's user-coordinate space, so hover math
// runs in the same scale the chart was drawn with.
export function clientToSvg(svgEl, clientX, clientY) {
    const pt = svgEl.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svgEl.getScreenCTM();
    if (!ctm) return null;
    return pt.matrixTransform(ctm.inverse());
}

// True when the primary pointer is coarse (a finger). On a narrow touch
// viewport the floating tooltip can't avoid covering its own point, so charts
// dock the reading into a fixed strip instead. matchMedia is guarded for
// non-DOM test environments.
export function coarsePointer() {
    return (
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(pointer: coarse)").matches
    );
}

// Wrap an SVG in a positioning container plus a floating tooltip (hover) and a
// docked-readout strip (touch). Both stay in the layout tree (visibility +
// opacity, not display:none) so their size is right on the first frame -
// positionTooltip reads offsetWidth/Height to clamp. CSS hides the readout on
// fine-pointer devices.
export function createChartShell(svgEl) {
    const shell = document.createElement("div");
    shell.className = "chart-shell";

    // Docked reading strip, first child so it sits above the plot. aria-hidden:
    // it's a pointer affordance like the tip; the spoken value comes from the
    // keyboard live region.
    const readout = document.createElement("div");
    readout.className = "chart-readout";
    readout.setAttribute("aria-hidden", "true");

    const tip = document.createElement("div");
    tip.className = "chart-tooltip";
    tip.setAttribute("role", "tooltip");
    tip.setAttribute("aria-hidden", "true");

    shell.append(readout, svgEl, tip);
    return { shell, tip, readout };
}

// Below this plot width a floating tooltip (~200-420px) would cover the point
// it describes, so touch devices dock the readout instead. Wider plots float;
// paired with the coarse-pointer check below so a hover device always floats.
const DOCK_MAX_WIDTH = 600;

// Whether a chart of this width docks its readout vs floats a tooltip. Single
// source of truth so the scaffolds and the CSS can't disagree. Charts re-render
// on every width change, so rotate/resize re-evaluates this for free.
export function shouldDockReadout(chartWidth) {
    return coarsePointer() && chartWidth <= DOCK_MAX_WIDTH;
}

// The single surface charts use to present a reading, hiding the float-vs-dock
// decision. Wide/hover: floats by the cursor. Narrow touch: docks into the
// fixed strip so it never covers the plot, with a hidden mirror in the tooltip
// as the keyboard live region's source. `docked` is exposed so a chart can pick
// its idle behaviour (a docked chart shows the latest reading at rest).
//
//   present(buildBody, clientX, clientY): buildBody() returns a fresh body
//     fragment, called once (float) or twice (dock: strip + hidden mirror)
//     since a fragment is consumed on append.
//   clear(): dismiss the tooltip / blank the strip.
export function createReadout(shell, tip, readout, chartWidth) {
    const docked = shouldDockReadout(chartWidth);
    if (docked) shell.classList.add("chart-shell--readout-docked");
    return {
        docked,
        present(buildBody, clientX = 0, clientY = 0) {
            if (docked) {
                readout.replaceChildren(buildBody());
                readout.classList.add("is-visible");
                tip.replaceChildren(buildBody());
            } else {
                showTooltip(tip, buildBody());
                placeTooltipNextFrame(shell, tip, clientX, clientY);
            }
        },
        clear() {
            hideTooltip(tip);
            if (docked) {
                readout.classList.remove("is-visible");
                readout.replaceChildren();
            }
        },
    };
}

// Index of the data point whose X is closest to ``svgX``. ``xAtIndex``
// translates an index into the chart's X scale so callers don't need to rebuild
// the scale here.
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

// Like nearestIndex, but restricted to a caller-supplied set of candidate slot
// indices - typically only the slots carrying data. This makes an empty build
// unhoverable: the cursor snaps to the closest *real* point instead of a gap.
// Returns -1 when there are no candidates, which callers treat as off-plot
// (dismiss).
export function nearestIndexAmong(svgX, slots, xAtIndex) {
    let bestIdx = -1;
    let bestDist = Infinity;
    for (const i of slots) {
        const dist = Math.abs(xAtIndex(i) - svgX);
        if (dist < bestDist) {
            bestDist = dist;
            bestIdx = i;
        }
    }
    return bestIdx;
}

// Show / hide the tooltip via a CSS class so the element stays in the layout
// tree and ``offsetWidth`` returns the rendered size.
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

// Place the tooltip near the cursor, flipping side when the preferred one would
// cover the cursor or clip the edge, keeping a fixed gap. Preference: right
// (flips left), above (flips below). The shell rect is the clamp boundary.
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

    // Prefer right of cursor; flip left when it would clip the right edge. If
    // neither side fits, park it on the roomier side and accept the clamp.
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

    // Prefer above; flip below when the top would clip, then clamp to the
    // bottom edge as a last fallback.
    let top = y - tipH - TOOLTIP_GAP;
    if (top < TOOLTIP_PAD) top = y + TOOLTIP_GAP;
    if (top + tipH + TOOLTIP_PAD > rect.height) {
        top = rect.height - tipH - TOOLTIP_PAD;
    }

    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
}

// Position the tooltip after two animation frames so layout has settled and
// ``offsetWidth`` reports the real size. The second frame guards against
// subpixel layout in Safari.
export function placeTooltipNextFrame(shell, tip, clientX, clientY) {
    requestAnimationFrame(() => {
        positionTooltip(shell, tip, clientX, clientY);
        requestAnimationFrame(() =>
            positionTooltip(shell, tip, clientX, clientY),
        );
    });
}

// Travel (px) a finger must cover before the gesture locks to an axis. Below
// this it is still "maybe a tap"; above it the dominant axis decides scrub vs
// scroll. 8 px is the usual slop keeping a still-finger tap from reading as a
// drag.
const TOUCH_AXIS_SLOP = 8;

// Touch/pen "tap and scrub". The hover plumbing is mouse-only, so without this
// the tooltip - the only surface carrying exact values - is unreachable on a
// no-hover device. Caller wires the same show/hide it uses for mouse:
//   resolve(clientX, clientY) -> slot index, or null off-plot (tap dismisses).
//   show(idx, clientX, clientY) -> paint + position the tooltip for that slot.
//   hide() -> clear the tooltip.
//
// The first move locks the touch to one axis: a vertical drag goes back to the
// browser to scroll (never preventDefault); a horizontal drag is claimed for
// scrubbing (preventDefault, tooltip tracks the finger); a tap reads the point
// or dismisses in the gutter. The SVG's touch-action: pan-y (charts.css)
// matches this contract. The tooltip stays put after a lift.
export function attachTouchInspect(shell, { resolve, show, hide }) {
    // idle -> no touch; pending -> down but axis not yet decided; scrub ->
    // locked horizontal (we drive the tooltip); scroll -> locked vertical (we
    // stay out of the browser's way).
    let mode = "idle";
    let startX = 0;
    let startY = 0;
    const point = (ev) =>
        ev.touches?.[0] ?? ev.changedTouches?.[0] ?? null;

    shell.addEventListener(
        "touchstart",
        (ev) => {
            const p = point(ev);
            if (!p) {
                mode = "idle";
                return;
            }
            startX = p.clientX;
            startY = p.clientY;
            // Claim nothing until the first move reveals intent, so a vertical
            // swipe can still scroll the page.
            mode = "pending";
        },
        { passive: true },
    );

    shell.addEventListener(
        "touchmove",
        (ev) => {
            if (mode === "idle" || mode === "scroll") return;
            const p = point(ev);
            if (!p) return;
            if (mode === "pending") {
                const dx = Math.abs(p.clientX - startX);
                const dy = Math.abs(p.clientY - startY);
                if (dx < TOUCH_AXIS_SLOP && dy < TOUCH_AXIS_SLOP) return;
                // Horizontal intent scrubs, otherwise scroll; ties go to
                // scrolling so the page never feels stuck.
                mode = dx > dy ? "scrub" : "scroll";
                if (mode === "scroll") return;
            }
            const idx = resolve(p.clientX, p.clientY);
            if (idx == null) return;
            if (ev.cancelable) ev.preventDefault();
            show(idx, p.clientX, p.clientY);
        },
        { passive: false },
    );

    const end = (ev) => {
        // A lift while still pending is a tap: read the point under the finger,
        // or dismiss in the gutter. A scrub/scroll just resets; the tooltip
        // stays.
        if (mode === "pending") {
            const p = point(ev);
            if (p) {
                const idx = resolve(p.clientX, p.clientY);
                if (idx == null) hide();
                else show(idx, p.clientX, p.clientY);
            }
        }
        mode = "idle";
    };
    shell.addEventListener("touchend", end);
    shell.addEventListener("touchcancel", () => {
        mode = "idle";
    });
}

// Keyboard + screen-reader access to the same per-slot tooltip the pointer
// surfaces - the values live only there, so without this a keyboard/SR user has
// no path to the numbers. Caller passes the same show/hide as the pointer, plus
// xAt to place a synthetic cursor:
//   slots -> selectable slot indices in plot order (arrows walk these, so empty
//            builds are skipped as for the pointer).
//   show(idx, x, y) -> paint + position the tooltip for that slot.
//   hide() -> clear the tooltip.
//   xAt(idx) -> the slot's x in SVG space, to project a client point.
//
// The shell becomes a focusable role="application" so arrows reach this handler
// (not browse mode); a polite live region mirrors the tooltip so values are
// spoken. Left/Right (or Up/Down) step, Home/End jump, Escape/blur dismiss.
export function attachKeyboardInspect(shell, { slots, show, hide, xAt }) {
    if (!slots || slots.length < 1) return;

    const svgEl = shell.querySelector("svg");
    const label = svgEl?.getAttribute("aria-label");
    // Strip any trailing period so the hint reads as one clean sentence, not
    // "series.. Use arrow keys".
    const base = label ? label.replace(/[.\s]+$/, "") : "Chart";
    shell.tabIndex = 0;
    shell.setAttribute("role", "application");
    shell.setAttribute(
        "aria-label",
        `${base}. Use arrow keys to read each data point.`,
    );

    // Polite live region: the tooltip itself is aria-hidden (it is a pointer
    // affordance), so the spoken value comes from here.
    const live = document.createElement("div");
    live.className = "chart-shell__live";
    live.setAttribute("aria-live", "polite");
    shell.append(live);

    const svgWidth = svgEl?.viewBox?.baseVal?.width || 0;
    // Position within ``slots`` (not the raw slot index), so arrow navigation
    // steps over the gaps the chart left unselectable.
    let pos = -1;

    // Build a readable sentence from the tooltip's structured parts (title,
    // label/value rows, footer) rather than its raw textContent, which would
    // run the cells together.
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

    // Project the slot's x into a viewport point so the existing tooltip
    // positioner can place it; y sits mid-shell since the keyboard has no
    // pointer height.
    const synthClient = (i) => {
        const rect = shell.getBoundingClientRect();
        const frac = svgWidth ? xAt(i) / svgWidth : 0.5;
        return {
            clientX: rect.left + frac * rect.width,
            clientY: rect.top + rect.height / 2,
        };
    };

    const goTo = (nextPos) => {
        pos = Math.max(0, Math.min(slots.length - 1, nextPos));
        const slotIdx = slots[pos];
        const { clientX, clientY } = synthClient(slotIdx);
        show(slotIdx, clientX, clientY);
        announce();
    };

    const dismiss = () => {
        pos = -1;
        hide();
        live.textContent = "";
    };

    shell.addEventListener("keydown", (ev) => {
        switch (ev.key) {
            case "ArrowRight":
            case "ArrowDown":
                goTo(pos < 0 ? 0 : pos + 1);
                ev.preventDefault();
                break;
            case "ArrowLeft":
            case "ArrowUp":
                goTo(pos < 0 ? slots.length - 1 : pos - 1);
                ev.preventDefault();
                break;
            case "Home":
                goTo(0);
                ev.preventDefault();
                break;
            case "End":
                goTo(slots.length - 1);
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
