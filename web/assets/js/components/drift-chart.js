// Drift chart: how far each published map has wandered from a
// reference build, expressed as the share of mapping entries that
// differ. Two modes feed the same plot:
//
//   - "previous":  one line, drift(M_(i-1) -> M_i) for every i.
//                  Answers "how much did each release change?".
//   - "baseline":  one line per picked baseline, drift(B -> M) for
//                  every M in the timeline. Answers "how far has the
//                  map drifted from a chosen reference state?".
//
// Drift ratio is total_changes / max(entries_a, entries_b). Same
// denominator the diff explorer uses for the headline match-rate,
// so a drift of 8% here lines up with a 92% match-rate banner over
// in the diff explorer when the user picks the same pair.

import {
    labelDensityForWidth,
    mountResponsiveChart,
    pickAxisLabelIndices,
    plotBounds,
    renderXAxis,
    renderYAxis,
} from "../charts/chart-base.js";
import {
    clientToSvg,
    createChartShell,
    hideTooltip,
    nearestIndex,
    placeTooltipNextFrame,
    showTooltip,
} from "../charts/chart-interaction.js";
import { buildTooltipBody } from "../charts/chart-tooltip.js";
import { linearScale, niceTicks, smoothPath, svg } from "../charts/svg.js";
import { formatDate, formatNumber, formatPercent, shortDate } from "../format.js";
import { findDiff } from "../utils/diffs.js";
import { uniqueId } from "../utils/dom.js";
import { createDropdown } from "./dropdown.js";
import { createInfoTooltip } from "./info-tooltip.js";
import { createModeSwitch } from "./mode-switch.js";

const DOT_RADIUS = 3;
const HOVER_BLEED = 12;

// Cap the baseline picker so the legend stays scannable and we
// don't run out of distinct series colours. Five lines is already
// dense; beyond that the chart turns into spaghetti.
const SERIES_PALETTE = [
    "var(--color-series-1)",
    "var(--color-series-2)",
    "var(--color-series-3)",
    "var(--color-series-4)",
    "var(--color-series-5)",
];
const MAX_BASELINES = SERIES_PALETTE.length;

// Public mount: render the drift card under ``parent``. The card
// owns its own state (mode + picked baselines) and re-draws the
// chart on every state change.
export function mount(parent, maps, diffs) {
    if (!parent) return;
    if (!Array.isArray(maps) || maps.length < 2) {
        parent.replaceChildren(emptyState());
        return;
    }
    if (!Array.isArray(diffs) || diffs.length === 0) {
        parent.replaceChildren(emptyState());
        return;
    }

    const sortedMaps = [...maps].sort((a, b) =>
        a.released_at.localeCompare(b.released_at),
    );

    const state = {
        mode: "previous",
        baselines: [sortedMaps[0].name],
    };

    const card = document.createElement("article");
    card.className = "card chart-card drift-chart";

    const header = document.createElement("div");
    header.className = "drift-chart__header";

    const label = document.createElement("span");
    label.className = "card__label uppercase-label";
    label.textContent = "DRIFT OVER TIME";
    header.append(label);

    const modeSwitch = createModeSwitch({
        options: [
            { value: "previous", label: "vs previous" },
            { value: "baseline", label: "vs baseline" },
        ],
        value: state.mode,
        onChange: (next) => {
            state.mode = next;
            baselinePicker.setVisible(next === "baseline");
            rerender();
        },
        ariaLabel: "Drift comparison mode",
    });

    // The info trigger sits at the right end of the header,
    // matching the corner-pinned affordance on the cards that
    // have no controls. Keeping it inside the header keeps the
    // layout clean even when the mode switch is present.
    const explainer = createInfoTooltip({
        body: [
            "How far each published build has wandered from a reference, expressed as the share of mapping entries that differ.",
            {
                lead: "vs previous.",
                text: "Drift between every consecutive pair of builds. Spikes mark releases that moved the map a lot.",
            },
            {
                lead: "vs baseline.",
                text: "Pick one or more reference builds and watch how far every later build has drifted from them. Useful for measuring decay from a known good state.",
            },
            "Drift uses the same denominator as the match rate in the diff explorer, so 8 % drift here matches a 92 % match banner there.",
        ],
        ariaLabel: "About the drift chart",
    });
    explainer.classList.add("drift-chart__info");

    const controls = document.createElement("div");
    controls.className = "drift-chart__controls";
    controls.append(modeSwitch, explainer);
    header.append(controls);

    const baselinePicker = createBaselinePicker(
        sortedMaps,
        state.baselines,
        (next) => {
            state.baselines = next;
            rerender();
        },
    );
    baselinePicker.setVisible(state.mode === "baseline");

    const chartSlot = document.createElement("div");
    chartSlot.className = "drift-chart__plot";

    card.append(header, baselinePicker.elem, chartSlot);
    parent.replaceChildren(card);

    const rerender = () => {
        const series = computeSeries(sortedMaps, diffs, state);
        mountResponsiveChart(chartSlot, {
            title: null,
            draw: ({ width, height, layout }) =>
                buildPlot({ sortedMaps, series, width, height, layout }),
        });
    };
    rerender();
}

// Baseline picker (pills + add dropdown) -----------------------------------

function createBaselinePicker(sortedMaps, initial, onChange) {
    const elem = document.createElement("div");
    elem.className = "baseline-picker";

    const labelId = uniqueId("baseline-picker-label");
    const labelEl = document.createElement("span");
    labelEl.className = "baseline-picker__label";
    labelEl.id = labelId;
    labelEl.textContent = "Baselines";

    const pillRow = document.createElement("div");
    pillRow.className = "baseline-picker__pills";
    pillRow.setAttribute("role", "list");
    pillRow.setAttribute("aria-labelledby", labelId);

    const addSlot = document.createElement("div");
    addSlot.className = "baseline-picker__add";

    elem.append(labelEl, pillRow, addSlot);

    let baselines = [...initial];

    const removeBaseline = (name) => {
        if (baselines.length <= 1) return;
        baselines = baselines.filter((b) => b !== name);
        renderPills();
        renderAddDropdown();
        onChange(baselines);
    };

    const addBaseline = (name) => {
        if (!name) return;
        if (baselines.includes(name)) return;
        if (baselines.length >= MAX_BASELINES) return;
        baselines = [...baselines, name];
        renderPills();
        renderAddDropdown();
        onChange(baselines);
    };

    const renderPills = () => {
        pillRow.replaceChildren();
        baselines.forEach((name, idx) => {
            const map = sortedMaps.find((m) => m.name === name);
            if (!map) return;
            pillRow.append(
                createBaselinePill({
                    label: formatDate(map.released_at),
                    color: SERIES_PALETTE[idx % SERIES_PALETTE.length],
                    canRemove: baselines.length > 1,
                    onRemove: () => removeBaseline(name),
                }),
            );
        });
    };

    const renderAddDropdown = () => {
        addSlot.replaceChildren();
        const remaining = sortedMaps.filter(
            (m) => !baselines.includes(m.name),
        );
        if (baselines.length >= MAX_BASELINES || remaining.length === 0) {
            return;
        }
        const dropdown = createDropdown({
            options: remaining.map((m) => ({
                value: m.name,
                label: formatDate(m.released_at),
            })),
            value: null,
            placeholder: "+ Add baseline",
            ariaLabel: "Add baseline",
            onChange: (picked) => addBaseline(picked),
        });
        dropdown.classList.add("baseline-picker__add-dropdown");
        addSlot.append(dropdown);
    };

    renderPills();
    renderAddDropdown();

    return {
        elem,
        setVisible(visible) {
            elem.hidden = !visible;
        },
    };
}

function createBaselinePill({ label, color, canRemove, onRemove }) {
    const pill = document.createElement("span");
    pill.className = "baseline-pill";
    pill.setAttribute("role", "listitem");
    pill.style.setProperty("--pill-color", color);

    const swatch = document.createElement("span");
    swatch.className = "baseline-pill__swatch";
    swatch.setAttribute("aria-hidden", "true");

    const text = document.createElement("span");
    text.className = "baseline-pill__label";
    text.textContent = label;

    pill.append(swatch, text);

    if (canRemove) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "baseline-pill__remove";
        remove.setAttribute("aria-label", `Remove baseline ${label}`);
        remove.textContent = "\u00d7";
        remove.addEventListener("click", onRemove);
        pill.append(remove);
    }

    return pill;
}

// Pure data layer ----------------------------------------------------------

// Build the array of {label, color, points[]} the chart consumes,
// branching on the picked mode. Stays pure so it can be exercised
// without a DOM.
function computeSeries(sortedMaps, diffs, state) {
    if (state.mode === "previous") {
        const series = computePreviousSeries(sortedMaps, diffs);
        return series ? [{ ...series, color: SERIES_PALETTE[0] }] : [];
    }
    return state.baselines
        .map((name, idx) => {
            const series = computeBaselineSeries(sortedMaps, diffs, name);
            if (!series) return null;
            return { ...series, color: SERIES_PALETTE[idx % SERIES_PALETTE.length] };
        })
        .filter(Boolean);
}

function computePreviousSeries(sortedMaps, diffs) {
    const points = [];
    for (let i = 0; i < sortedMaps.length; i++) {
        if (i === 0) {
            points.push({
                map: sortedMaps[0],
                index: 0,
                drift_ratio: 0,
                total_changes: 0,
                denominator: sortedMaps[0].entries_count,
                vs: null,
            });
            continue;
        }
        const prev = sortedMaps[i - 1];
        const curr = sortedMaps[i];
        const diff = findDiff(diffs, prev.name, curr.name);
        if (!diff) continue;
        const denom = Math.max(diff.entries_a, diff.entries_b);
        points.push({
            map: curr,
            index: i,
            drift_ratio: denom ? diff.total_changes / denom : 0,
            total_changes: diff.total_changes,
            denominator: denom,
            vs: prev,
        });
    }
    return { label: "vs previous build", baseline: null, points };
}

function computeBaselineSeries(sortedMaps, diffs, baselineName) {
    const baseline = sortedMaps.find((m) => m.name === baselineName);
    if (!baseline) return null;
    const points = [];
    for (let i = 0; i < sortedMaps.length; i++) {
        const map = sortedMaps[i];
        if (map.name === baseline.name) {
            points.push({
                map,
                index: i,
                drift_ratio: 0,
                total_changes: 0,
                denominator: baseline.entries_count,
                vs: baseline,
            });
            continue;
        }
        const diff = findDiff(diffs, baseline.name, map.name);
        if (!diff) continue;
        const denom = Math.max(diff.entries_a, diff.entries_b);
        points.push({
            map,
            index: i,
            drift_ratio: denom ? diff.total_changes / denom : 0,
            total_changes: diff.total_changes,
            denominator: denom,
            vs: baseline,
        });
    }
    return {
        label: `vs ${formatDate(baseline.released_at)}`,
        baseline,
        points,
    };
}

// Plot drawing -------------------------------------------------------------

function buildPlot({ sortedMaps, series, width, height, layout }) {
    if (series.length === 0) {
        return emptyState("No drift data for the picked selection.");
    }
    const plot = plotBounds(width, height, layout);

    const allRatios = series.flatMap((s) => s.points.map((p) => p.drift_ratio));
    const maxRatio = Math.max(0.01, ...allRatios);
    const yTicks = niceTicks(0, maxRatio);
    const yScale = linearScale(
        [yTicks[0], yTicks.at(-1)],
        [plot.bottom, plot.top],
    );
    const xScale = linearScale(
        [0, sortedMaps.length - 1],
        [plot.left, plot.right],
    );
    const xAt = (i) => xScale(i);

    const root = svg("svg", {
        viewBox: `0 0 ${width} ${height}`,
        class: "chart",
        role: "presentation",
    });
    root.setAttribute(
        "aria-label",
        "Drift over time; share of mapping entries that differ from the chosen reference build",
    );

    renderYAxis(root, yTicks, yScale, {
        plotLeft: plot.left,
        plotRight: plot.right,
        format: (tick) => formatPercent(tick, 0),
    });
    renderXAxis(
        root,
        pickAxisLabelIndices(sortedMaps.length, labelDensityForWidth(width)),
        xAt,
        plot.bottom,
        (i) => shortDate(sortedMaps[i].released_at),
    );

    for (const s of series) {
        const points = s.points.map((p) => [xAt(p.index), yScale(p.drift_ratio)]);
        if (points.length < 2) continue;
        root.append(
            svg("path", {
                d: smoothPath(points),
                class: "chart__line drift-chart__line",
                style: `stroke: ${s.color}`,
            }),
        );
        for (const point of s.points) {
            root.append(
                svg("circle", {
                    cx: xAt(point.index),
                    cy: yScale(point.drift_ratio),
                    r: DOT_RADIUS,
                    class: "chart__dot drift-chart__dot",
                    style: `fill: ${s.color}; stroke: ${s.color}`,
                }),
            );
        }
    }

    const cursorLine = svg("line", {
        x1: plot.left,
        x2: plot.left,
        y1: plot.top,
        y2: plot.bottom,
        class: "chart__cursor-line",
        visibility: "hidden",
    });
    root.append(cursorLine);

    const { shell, tip } = createChartShell(root);

    function hideHover() {
        hideTooltip(tip);
        cursorLine.setAttribute("visibility", "hidden");
    }

    function showHover(idx, ev) {
        const map = sortedMaps[idx];
        cursorLine.setAttribute("x1", String(xAt(idx)));
        cursorLine.setAttribute("x2", String(xAt(idx)));
        cursorLine.setAttribute("visibility", "visible");

        const rows = [];
        for (const s of series) {
            const point = s.points.find((p) => p.index === idx);
            if (!point) continue;
            rows.push([
                s.label,
                pointTooltipText(point),
            ]);
        }
        showTooltip(
            tip,
            buildTooltipBody({
                title: formatDate(map.released_at),
                rows,
            }),
        );
        placeTooltipNextFrame(shell, tip, ev.clientX, ev.clientY);
    }

    shell.addEventListener("mousemove", (ev) => {
        const pt = clientToSvg(root, ev.clientX, ev.clientY);
        if (!pt) return;
        if (
            pt.x < plot.left - HOVER_BLEED ||
            pt.x > plot.right + HOVER_BLEED ||
            pt.y < plot.top ||
            pt.y > plot.bottom
        ) {
            hideHover();
            return;
        }
        showHover(nearestIndex(pt.x, sortedMaps.length, xAt), ev);
    });
    shell.addEventListener("mouseleave", hideHover);

    return shell;
}

function pointTooltipText(point) {
    if (point.total_changes === 0) return "0% (reference)";
    return `${formatPercent(point.drift_ratio, 1)} (${formatNumber(point.total_changes)} changes)`;
}

function emptyState(text = "Need at least two builds and one diff to plot drift.") {
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = text;
    return note;
}
