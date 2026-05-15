// Low-level SVG primitives: namespaced element factory, linear
// scales, "nice" tick generation, and Catmull-Rom-based smooth
// path / area helpers. Shared by every chart so axis math and
// curve geometry stay consistent across visualisations.

export const SVG_NS = "http://www.w3.org/2000/svg";

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

// Catmull-Rom -> cubic Bezier conversion. Given an ordered list of
// [x, y] points, returns an SVG path "d" attribute that draws a
// smooth curve through every point. The tension factor 6 is the
// canonical value that turns Catmull-Rom into a uniform B-spline-ish
// curve; lowering it would make corners sharper.
//
// At the endpoints we mirror the neighbour so the curve doesn't
// overshoot.
export function smoothPath(points) {
    if (points.length < 2) return "";
    if (points.length === 2) {
        return `M${points[0][0]},${points[0][1]} L${points[1][0]},${points[1][1]}`;
    }

    const out = [`M${points[0][0]},${points[0][1]}`];
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i - 1] || points[i];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[i + 2] || p2;

        const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
        const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
        const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
        const cp2y = p2[1] - (p3[1] - p1[1]) / 6;

        out.push(`C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2[0]},${p2[1]}`);
    }
    return out.join(" ");
}

// Build a closed path that fills the area between the smoothed line
// and a horizontal baseline (typically the bottom of the chart).
// Reuses smoothPath() for the top edge so the line and the fill never
// drift apart on resize or recompute.
export function areaPath(points, baselineY) {
    if (points.length < 2) return "";
    const top = smoothPath(points);
    const first = points[0];
    const last = points[points.length - 1];
    return `${top} L${last[0]},${baselineY} L${first[0]},${baselineY} Z`;
}
