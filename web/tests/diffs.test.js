// Diff lookups: symmetric vs strict-directional, the single drift-view shape,
// and the "previous diffable" walk that skips filled-only builds. The ratio
// must be 0 (not NaN) when a side has no resource - that guard is load-bearing
// for tooltips and is easy to regress.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    DRIFT_IPV4_COVERAGE,
    DRIFT_IPV6_COVERAGE,
    findDiff,
    findDirectionalDiff,
    driftViews,
    previousDiffable,
} from "../assets/js/utils/diffs.js";

const diffs = [{ from: "a", to: "b", ipv4_addresses_changed: 1 }];

test("findDiff matches either direction", () => {
    assert.equal(findDiff(diffs, "a", "b"), diffs[0]);
    assert.equal(findDiff(diffs, "b", "a"), diffs[0]);
    assert.equal(findDiff(diffs, "a", "z"), null);
    assert.equal(findDiff(null, "a", "b"), null);
});

test("findDirectionalDiff matches only the canonical from->to", () => {
    assert.equal(findDirectionalDiff(diffs, "a", "b"), diffs[0]);
    assert.equal(findDirectionalDiff(diffs, "b", "a"), null);
});

test("driftViews returns ratio/changed/denominator per family", () => {
    const views = driftViews({
        ipv4_addresses_changed: 50,
        ipv4_address_space_union: 200,
        ipv6_addresses_changed: 0,
        ipv6_address_space_union: 0,
    });
    assert.deepEqual(views[DRIFT_IPV4_COVERAGE], {
        ratio: 0.25,
        changed: 50,
        denominator: 200,
    });
    // Zero denominator => ratio 0, never NaN.
    assert.deepEqual(views[DRIFT_IPV6_COVERAGE], {
        ratio: 0,
        changed: 0,
        denominator: 0,
    });
});

test("driftViews coerces missing fields to zero", () => {
    const views = driftViews({});
    assert.deepEqual(views[DRIFT_IPV4_COVERAGE], {
        ratio: 0,
        changed: 0,
        denominator: 0,
    });
});

test("previousDiffable skips filled-only builds", () => {
    const maps = [
        { name: "m0", unfilled: { present: true } },
        { name: "m1", filled: { present: true } },
        { name: "m2", unfilled: { present: true } },
    ];
    assert.equal(previousDiffable(maps, "m2").name, "m0");
    assert.equal(previousDiffable(maps, "m1").name, "m0");
});

test("previousDiffable is null for the oldest or an unknown build", () => {
    const maps = [{ name: "m0", unfilled: { present: true } }];
    assert.equal(previousDiffable(maps, "m0"), null);
    assert.equal(previousDiffable(maps, "missing"), null);
    assert.equal(previousDiffable(null, "m0"), null);
});
