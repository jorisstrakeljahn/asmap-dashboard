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
