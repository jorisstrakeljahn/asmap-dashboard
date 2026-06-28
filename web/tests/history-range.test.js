// Range resolution drives every history chart's cutoff + x-domain, and it is
// "now"-anchored, so the off-by-a-day / empty-slice edges are the ones worth
// pinning. Pure date math - no DOM, runs under `node --test`.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    MS_PER_DAY,
    rangeBounds,
    resolveHistoryRange,
} from "../assets/js/utils/history-range.js";

const isoDaysAgo = (days) =>
    new Date(Date.now() - days * MS_PER_DAY).toISOString();

test("max spans the data and anchors the domain to at least now", () => {
    const oldest = Date.now() - 1000 * MS_PER_DAY;
    const newest = Date.now() - 10 * MS_PER_DAY;
    const before = Date.now();
    const { cutoff, domainStart, domainEnd } = rangeBounds("max", [
        oldest,
        newest,
    ]);
    assert.equal(cutoff, -Infinity);
    assert.equal(domainStart, oldest);
    // Past data => the right edge is "now", not the last point.
    assert.ok(domainEnd >= before);
});

test("an unknown range falls back to max rather than dropping everything", () => {
    assert.equal(rangeBounds("7d", [1, 2, 3]).cutoff, -Infinity);
});

test("a bounded range is a now-anchored window of exactly N days", () => {
    const before = Date.now();
    const { cutoff, domainStart, domainEnd } = rangeBounds("1y");
    const after = Date.now();
    assert.equal(domainStart, cutoff);
    assert.equal(domainEnd - cutoff, 365 * MS_PER_DAY);
    assert.ok(domainEnd >= before && domainEnd <= after);
});

test("resolveHistoryRange drops points older than a bounded cutoff", () => {
    const maps = [
        { name: "old", released_at: isoDaysAgo(800) },
        { name: "mid", released_at: isoDaysAgo(200) },
        { name: "new", released_at: isoDaysAgo(5) },
    ];
    const { maps: kept } = resolveHistoryRange(maps, "1y");
    assert.deepEqual(
        kept.map((m) => m.name),
        ["mid", "new"],
    );
});

test("max keeps every map", () => {
    const maps = [
        { name: "old", released_at: isoDaysAgo(800) },
        { name: "new", released_at: isoDaysAgo(5) },
    ];
    assert.equal(resolveHistoryRange(maps, "max").maps.length, 2);
});

test("an empty slice yields null bounds so the empty state can take over", () => {
    const allTooOld = [{ name: "old", released_at: isoDaysAgo(800) }];
    const result = resolveHistoryRange(allTooOld, "1y");
    assert.deepEqual(result, { maps: [], domainStart: null, domainEnd: null });
});

test("non-array input is treated as empty", () => {
    assert.deepEqual(resolveHistoryRange(undefined), {
        maps: [],
        domainStart: null,
        domainEnd: null,
    });
});
