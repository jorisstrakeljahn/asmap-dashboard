// Low-level SVG primitives: namespaced element factory, linear
// scales, "nice" tick generation, and Catmull-Rom-based smooth
// path / area helpers. Shared by every chart so axis math and
// curve geometry stay consistent across visualisations.

import { SVG_NS } from "../utils/dom.js";

// Re-exported so chart code importing SVG_NS from here keeps
// working; the source of truth lives in utils/dom.js.
export { SVG_NS };

export function svg(name, attrs = {}) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attrs)) {
        if (value === undefined || value === null) continue;
        node.setAttribute(key, String(value));
    }
    return node;
}

export function linearScale(domain, range) {
    const [d0, d1] = domain;
    const [r0, r1] = range;
    const span = d1 - d0 || 1;
    return (value) => r0 + ((value - d0) / span) * (r1 - r0);
}

export function niceTicks(min, max, count = 5) {
    if (min === max) return [min];
    const range = max - min;
    const rough = range / (count - 1);
    const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
    const candidates = [1, 2, 2.5, 5, 10].map((m) => m * magnitude);
    const step = candidates.find((c) => c >= rough) || candidates.at(-1);
    const start = Math.floor(min / step) * step;
    const end = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = start; v <= end + step / 2; v += step) {
        ticks.push(Number(v.toFixed(10)));
    }
    return ticks;
}

// Monotone cubic interpolation (Fritsch-Carlson). Emits an SVG
// path "d" that glides through every point without overshooting:
// peaks stay peaks and troughs stay troughs, so the curve never
// claims a value the input didn't carry.
//
// Plain Catmull-Rom assumes uniform parameter spacing, which kinks
// on a calendar x axis where a wide gap meets a narrow step.
// Fritsch-Carlson sizes each tangent from the real secant slopes,
// so non-uniform spacing stays clean and monotone runs render
// monotonically.
//
// Algorithm:
//   1. delta[i] = secant slope between points i and i+1.
//   2. m[i] = average of the two adjacent secants (Bessel
//      tangent), with endpoints copying their only neighbour.
//   3. At every local extremum (adjacent secants of opposite sign,
//      or either zero), the tangent collapses to zero — otherwise
//      the curve overshoots the peak, which step 4 alone cannot fix
//      once the average points the wrong way.
//   4. Fritsch-Carlson constraint: alpha = m[i]/delta[i],
//      beta = m[i+1]/delta[i]. If alpha^2 + beta^2 > 9, scale both
//      tangents by 3 / sqrt(alpha^2 + beta^2), bounding the slope
//      when neighbours are monotone but very steep.
//   5. Emit one cubic Bezier per segment with control points offset
//      along x by dx/3 (the Hermite-to-Bezier conversion).
export function smoothPath(points) {
    if (points.length < 2) return "";
    if (points.length === 2) {
        return `M${points[0][0]},${points[0][1]} L${points[1][0]},${points[1][1]}`;
    }

    const n = points.length;
    const deltas = new Array(n - 1);
    for (let i = 0; i < n - 1; i++) {
        const dx = points[i + 1][0] - points[i][0];
        const dy = points[i + 1][1] - points[i][1];
        deltas[i] = dx === 0 ? 0 : dy / dx;
    }

    const tangents = new Array(n);
    tangents[0] = deltas[0];
    tangents[n - 1] = deltas[n - 2];
    for (let i = 1; i < n - 1; i++) {
        // Zero the tangent at local extrema. A non-positive product
        // means the surrounding secants oppose (peak / trough) or one
        // is flat, so a flat tangent is the only choice that keeps the
        // cubic within the neighbours' [min, max].
        if (deltas[i - 1] * deltas[i] <= 0) {
            tangents[i] = 0;
        } else {
            tangents[i] = (deltas[i - 1] + deltas[i]) / 2;
        }
    }

    for (let i = 0; i < n - 1; i++) {
        if (deltas[i] === 0) {
            tangents[i] = 0;
            tangents[i + 1] = 0;
            continue;
        }
        const alpha = tangents[i] / deltas[i];
        const beta = tangents[i + 1] / deltas[i];
        const r = alpha * alpha + beta * beta;
        if (r > 9) {
            const scale = 3 / Math.sqrt(r);
            tangents[i] = scale * alpha * deltas[i];
            tangents[i + 1] = scale * beta * deltas[i];
        }
    }

    const out = [`M${points[0][0]},${points[0][1]}`];
    for (let i = 0; i < n - 1; i++) {
        const dx = points[i + 1][0] - points[i][0];
        const cp1x = points[i][0] + dx / 3;
        const cp1y = points[i][1] + (tangents[i] * dx) / 3;
        const cp2x = points[i + 1][0] - dx / 3;
        const cp2y = points[i + 1][1] - (tangents[i + 1] * dx) / 3;
        out.push(
            `C${cp1x},${cp1y} ${cp2x},${cp2y} ${points[i + 1][0]},${points[i + 1][1]}`,
        );
    }
    return out.join(" ");
}
