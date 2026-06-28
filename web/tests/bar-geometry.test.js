// Bar width is derived from the tightest neighbour gap and clamped, with two
// fallbacks (single slot, collapsed gaps). The clamp + fallbacks are the parts
// that keep dense clusters from overlapping and sparse ranges from rendering
// chart-wide blocks, so they get the coverage.

import { test } from "node:test";
import assert from "node:assert/strict";

import { BAR_CORNER_RADIUS, pickBarWidth } from "../assets/js/charts/bar-geometry.js";

const identity = (x) => x;
const plot = { left: 0, right: 10 };

test("a single slot (or none) falls back to the max width", () => {
    assert.equal(pickBarWidth([100], identity, plot), 14);
    assert.equal(pickBarWidth([], identity, plot), 14);
});

test("wide gaps clamp to the max width", () => {
    // minGap 100 * 0.7 = 70, clamped to 14.
    assert.equal(pickBarWidth([0, 100, 200], identity, plot), 14);
});

test("a mid gap scales by the fill fraction", () => {
    // minGap 10 * 0.7 = 7, inside [3, 14].
    assert.equal(pickBarWidth([0, 10], identity, plot), 7);
});

test("tight gaps clamp up to the min width", () => {
    // minGap 2 * 0.7 = 1.4, clamped up to 3.
    assert.equal(pickBarWidth([0, 2], identity, plot), 3);
});

test("the smallest gap wins, not the first", () => {
    // gaps 10 then 5 -> minGap 5 * 0.7 = 3.5.
    assert.equal(pickBarWidth([0, 10, 15], identity, plot), 3.5);
});

test("collapsed gaps fall back to the plot width", () => {
    // Duplicate timestamps => no positive gap => min(maxWidth, plot span).
    assert.equal(pickBarWidth([5, 5], identity, plot), 10);
});

test("corner radius is a stable shared constant", () => {
    assert.equal(BAR_CORNER_RADIUS, 2);
});
