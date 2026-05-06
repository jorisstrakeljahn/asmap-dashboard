import { linearScale, niceTicks, svg } from "../charts/svg.js";
import { formatDate, formatNumber, shortDate } from "../format.js";

const WIDTH = 920;
const HEIGHT = 220;
const PADDING_LEFT = 50;
const PADDING_RIGHT = 15;
const PADDING_TOP = 20;
const PADDING_BOTTOM = 28;
const BAR_GAP = 12;

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
    title.textContent = "Size Delta Between Consecutive Maps".toUpperCase();
    card.append(title);

    card.append(chart(deltas(maps)));
    return card;
}

function deltas(maps) {
    return maps.slice(1).map((m, i) => ({
        released_at: m.released_at,
        delta: m.entries_count - maps[i].entries_count,
    }));
}

function chart(rows) {
    const values = rows.map((r) => r.delta);
    const yMin = Math.min(0, ...values);
    const yMax = Math.max(0, ...values);
    const yTicks = niceTicks(yMin, yMax);
    const yScale = linearScale(
        [yTicks[0], yTicks.at(-1)],
        [HEIGHT - PADDING_BOTTOM, PADDING_TOP],
    );

    const plotW = WIDTH - PADDING_LEFT - PADDING_RIGHT;
    const slot = plotW / rows.length;
    const barW = Math.max(8, slot - BAR_GAP);

    const root = svg("svg", {
        viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
        class: "chart",
        role: "img",
        "aria-label": "Entry-count delta between consecutive ASmap builds",
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
        root.lastChild.textContent = formatTick(tick);
    }

    const baselineY = yScale(0);
    rows.forEach((row, i) => {
        const cx = PADDING_LEFT + slot * (i + 0.5);
        const top = yScale(Math.max(0, row.delta));
        const bottom = yScale(Math.min(0, row.delta));
        const bar = svg("rect", {
            x: cx - barW / 2,
            y: top,
            width: barW,
            height: Math.max(1, bottom - top),
            rx: 2,
            class: "chart__bar",
        });
        const titleNode = svg("title");
        titleNode.textContent = `${formatDate(row.released_at)}: ${formatNumber(row.delta)} entries`;
        bar.append(titleNode);
        root.append(bar);

        const label = svg("text", {
            x: cx,
            y: HEIGHT - PADDING_BOTTOM + 16,
            class: "chart__x-label",
            "text-anchor": "middle",
        });
        label.textContent = shortDate(row.released_at);
        root.append(label);
    });

    if (yMin < 0 && yMax > 0) {
        root.append(
            svg("line", {
                x1: PADDING_LEFT,
                x2: WIDTH - PADDING_RIGHT,
                y1: baselineY,
                y2: baselineY,
                class: "chart__zero",
            }),
        );
    }

    return root;
}

function formatTick(value) {
    const abs = Math.abs(value);
    if (abs >= 1000) return `${Math.round(value / 1000)}k`;
    return String(value);
}
