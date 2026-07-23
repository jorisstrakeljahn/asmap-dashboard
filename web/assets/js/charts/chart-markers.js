// DOM rendering for optional vertical chart annotations.
import { visibleXMarkers } from "./chart-marker-data.js";
import { svg } from "./svg.js";

export function drawXMarkers(root, geometry, markers) {
    const { plot, xScale, domainStart, domainEnd } = geometry;
    for (const marker of visibleXMarkers(markers, domainStart, domainEnd)) {
        const x = xScale(marker.timestamp);
        const onRight = x > (plot.left + plot.right) / 2;
        const label = svg("text", {
            x: x + (onRight ? -5 : 5),
            y: 12,
            "text-anchor": onRight ? "end" : "start",
            class: "chart__transition-label",
        });
        label.textContent = marker.label;
        root.append(
            svg("line", {
                x1: x,
                x2: x,
                y1: plot.top,
                y2: plot.bottom,
                class: "chart__transition-line",
            }),
            label,
        );
    }
}
