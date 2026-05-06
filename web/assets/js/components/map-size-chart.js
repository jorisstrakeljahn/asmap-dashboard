import { linearScale, niceTicks, svg } from "../charts/svg.js";
import { formatDate, shortDate } from "../format.js";

const WIDTH = 920;
const HEIGHT = 220;
const PADDING_LEFT = 50;
const PADDING_RIGHT = 15;
const PADDING_TOP = 20;
const PADDING_BOTTOM = 28;

export function mount(parent, maps) {
    if (maps.length < 2) {
        parent.replaceChildren();
        return;
    }
    parent.replaceChildren(card(maps));
}

function card(maps) {
    const card = document.createElement("article");
    card.className = "card chart-card";

    const title = document.createElement("span");
    title.className = "card__label uppercase-label";
    title.textContent = "Map Size Over Time".toUpperCase();
    card.append(title);

    card.append(chart(maps));
    return card;
}

function chart(maps) {
    const sizes = maps.map((m) => m.file_size_bytes);
    const yTicks = niceTicks(Math.min(...sizes), Math.max(...sizes));
    const yScale = linearScale(
        [yTicks[0], yTicks.at(-1)],
        [HEIGHT - PADDING_BOTTOM, PADDING_TOP],
    );
    const xScale = linearScale(
        [0, maps.length - 1],
        [PADDING_LEFT, WIDTH - PADDING_RIGHT],
    );

    const root = svg("svg", {
        viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
        class: "chart",
        role: "img",
        "aria-label": "ASmap file size over time",
    });

    for (const tick of yTicks) {
        const y = yScale(tick);
        root.append(
            svg("line", {
                x1: PADDING_LEFT,
                x2: WIDTH - PADDING_RIGHT,
                y1: y,
                y2: y,
                class: "chart__grid",
            }),
            svg("text", {
                x: PADDING_LEFT - 8,
                y: y + 4,
                class: "chart__y-label",
                "text-anchor": "end",
            }),
        );
        root.lastChild.textContent = `${(tick / 1e6).toFixed(2)}M`;
    }

    const xLabelIndices = pickXLabelIndices(maps.length);
    for (const idx of xLabelIndices) {
        root.append(
            svg("text", {
                x: xScale(idx),
                y: HEIGHT - PADDING_BOTTOM + 16,
                class: "chart__x-label",
                "text-anchor": "middle",
            }),
        );
        root.lastChild.textContent = shortDate(maps[idx].released_at);
    }

    const path = maps
        .map((m, i) => `${i === 0 ? "M" : "L"}${xScale(i)},${yScale(m.file_size_bytes)}`)
        .join(" ");
    root.append(svg("path", { d: path, class: "chart__line" }));

    for (let i = 0; i < maps.length; i++) {
        const dot = svg("circle", {
            cx: xScale(i),
            cy: yScale(maps[i].file_size_bytes),
            r: 3,
            class: "chart__dot",
        });
        const title = svg("title");
        title.textContent = `${formatDate(maps[i].released_at)}: ${maps[i].file_size_bytes.toLocaleString()} bytes`;
        dot.append(title);
        root.append(dot);
    }

    return root;
}

function pickXLabelIndices(count) {
    if (count <= 6) return [...Array(count).keys()];
    const last = count - 1;
    return [0, Math.round(last / 4), Math.round(last / 2), Math.round((last * 3) / 4), last];
}
