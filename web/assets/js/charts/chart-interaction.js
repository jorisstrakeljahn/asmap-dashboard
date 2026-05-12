// Chart hover plumbing: pointer math, tooltip element, tooltip
// positioning. Nothing in here knows what the tooltip *says* —
// see chart-tooltip.js for the content builder.

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

// Place the tooltip near the cursor and clamp it inside the chart
// shell so it never spills over the card border.
export function positionTooltip(shell, tip, clientX, clientY) {
    const rect = shell.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const pad = 8;
    const tipW = tip.offsetWidth || 200;
    const tipH = tip.offsetHeight || 40;
    let left = x + 14;
    let top = y - tipH - 10;
    if (left + tipW + pad > rect.width) left = rect.width - tipW - pad;
    if (left < pad) left = pad;
    if (top < pad) top = y + 14;
    if (top + tipH + pad > rect.height) top = rect.height - tipH - pad;
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
