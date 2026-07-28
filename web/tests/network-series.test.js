import assert from "node:assert/strict";
import test from "node:test";

import { visibleXMarkers } from "../assets/js/charts/chart-marker-data.js";
import {
    defaultDecayReference,
    resolveDecayReference,
} from "../assets/js/components/network/decay-reference.js";
import { crossCheckSummary } from "../assets/js/components/network/quality-data.js";
import {
    SOURCE_ORDER,
    buildUnionTimeline,
} from "../assets/js/components/network/series-data.js";
import { stalenessAtTarget } from "../assets/js/components/network/staleness-data.js";
import {
    buildChangeTimestamps,
    chartGranularity,
    clampTimeline,
    dayUnionTimeline,
    downsampleSnapshots,
    periodKey,
    periodUnionTimeline,
    selectDisplaySnapshots,
} from "../assets/js/components/network/timelines.js";

test("Network exposes one continuous Bitnodes source", () => {
    assert.deepEqual(SOURCE_ORDER, ["bitnodes"]);
});

test("transition markers are clipped to the visible chart range", () => {
    const markers = [
        { timestamp: 100, label: "before" },
        { timestamp: 200, label: "handoff" },
        { timestamp: 300, label: "after" },
    ];

    assert.deepEqual(visibleXMarkers(markers, 150, 250), [markers[1]]);
});

test("missing live WHOIS defaults decay to the map reference", () => {
    const network = { sources: { bitnodes: { decay: { points: [{}] } } } };

    assert.equal(defaultDecayReference(network, ["bitnodes"]), "map");
    assert.equal(
        resolveDecayReference(network, ["bitnodes"], "truth"),
        "map",
    );
});

test("available live WHOIS keeps Reality as the decay default", () => {
    const network = {
        sources: { bitnodes: { decay_truth: { points: [{}] } } },
    };

    assert.equal(defaultDecayReference(network, ["bitnodes"]), "truth");
});

test("cross-check never falls back to an annotated archive", () => {
    const network = {
        sources: {
            bitnodes: {
                snapshots: [
                    {
                        timestamp: 100,
                        cross_check: { agreement_pct: 93 },
                    },
                    { timestamp: 200, cross_check: null },
                ],
            },
        },
    };

    assert.equal(crossCheckSummary(network, ["bitnodes"], "bitnodes"), null);
});

test("cross-check reads the latest live value when WHOIS is present", () => {
    const current = { agreement_pct: 94 };
    const network = {
        sources: {
            bitnodes: {
                snapshots: [
                    {
                        timestamp: 100,
                        cross_check: { agreement_pct: 93 },
                    },
                    { timestamp: 200, cross_check: current },
                ],
            },
        },
    };

    const summary = crossCheckSummary(network, ["bitnodes"], "bitnodes");
    assert.equal(summary.latest.cc, current);
    assert.deepEqual(summary.values, [94, 93]);
});

test("archive and live points form one chronological timeline", () => {
    const timeline = buildUnionTimeline([
        {
            source: "bitnodes",
            points: [
                { ts: 100, value: 1 },
                { ts: 300, value: 3 },
                { ts: 200, value: 2 },
            ],
        },
    ]);

    assert.deepEqual(timeline.timestamps, [100, 200, 300]);
    assert.equal(timeline.valueAt("bitnodes", 1), 2);
});

test("daily timeline keeps one value per source and clamps old days", () => {
    const day = 86_400_000;
    const timeline = dayUnionTimeline([
        {
            source: "bitnodes",
            points: [
                { ts: day + 100, value: 1 },
                { ts: 2 * day + 100, value: 2 },
            ],
        },
    ]);
    const clamped = clampTimeline(timeline, 2 * day);

    assert.deepEqual(clamped.timestamps, [2 * day + 100]);
    assert.equal(clamped.valueAt("bitnodes", 0), 2);
});

test("chart granularity is weekly on 1Y and monthly on longer windows", () => {
    assert.equal(chartGranularity("1y"), "week");
    assert.equal(chartGranularity("3y"), "month");
    assert.equal(chartGranularity("5y"), "month");
    assert.equal(chartGranularity("max"), "month");
});

test("weekly timeline keeps the earliest value in each Monday-start week", () => {
    // Mon 2026-07-06 and Sun 2026-07-12 are the same ISO-style week;
    // Mon 2026-07-13 opens the next one. Earliest-per-week keeps spacing even.
    const mon = Date.UTC(2026, 6, 6, 12);
    const sun = Date.UTC(2026, 6, 12, 18);
    const nextMon = Date.UTC(2026, 6, 13, 9);
    assert.equal(periodKey(mon, "week"), periodKey(sun, "week"));
    assert.notEqual(periodKey(mon, "week"), periodKey(nextMon, "week"));

    const timeline = periodUnionTimeline(
        [
            {
                source: "bitnodes",
                points: [
                    { ts: mon, value: 1 },
                    { ts: sun, value: 2 },
                    { ts: nextMon, value: 3 },
                ],
            },
        ],
        "week",
    );

    assert.deepEqual(timeline.timestamps, [mon, nextMon]);
    assert.equal(timeline.valueAt("bitnodes", 0), 1);
    assert.equal(timeline.valueAt("bitnodes", 1), 3);
});

test("monthly timeline collapses a month to its earliest sample", () => {
    const early = Date.UTC(2026, 0, 3);
    const late = Date.UTC(2026, 0, 28);
    const next = Date.UTC(2026, 1, 2);
    const timeline = periodUnionTimeline(
        [
            {
                source: "bitnodes",
                points: [
                    { ts: early, value: 10 },
                    { ts: late, value: 20 },
                    { ts: next, value: 30 },
                ],
            },
        ],
        "month",
    );

    assert.deepEqual(timeline.timestamps, [early, next]);
    assert.equal(timeline.valueAt("bitnodes", 0), 10);
});

test("snapshot downsample keeps the earliest crawl per period", () => {
    const snapshots = [
        { timestamp: Date.UTC(2026, 6, 6) / 1000, label: "mon" },
        { timestamp: Date.UTC(2026, 6, 8) / 1000, label: "wed" },
        { timestamp: Date.UTC(2026, 6, 13) / 1000, label: "next-mon" },
    ];
    const kept = downsampleSnapshots(snapshots, -Infinity, "week");
    assert.deepEqual(
        kept.map((sn) => sn.label),
        ["mon", "next-mon"],
    );
});

test("build-change anchors are the first crawl on each new map", () => {
    const snapshots = [
        {
            timestamp: Date.UTC(2026, 6, 6) / 1000,
            label: "mon",
            build: { timestamp: 100 },
        },
        {
            timestamp: Date.UTC(2026, 6, 8) / 1000,
            label: "wed-map",
            build: { timestamp: 200 },
        },
        {
            timestamp: Date.UTC(2026, 6, 10) / 1000,
            label: "fri",
            build: { timestamp: 200 },
        },
        {
            timestamp: Date.UTC(2026, 6, 13) / 1000,
            label: "next-mon",
            build: { timestamp: 200 },
        },
    ];
    assert.deepEqual(buildChangeTimestamps(snapshots), [
        Date.UTC(2026, 6, 6),
        Date.UTC(2026, 6, 8),
    ]);
});

test("display selection prefers the map crawl over a same-week filler", () => {
    const snapshots = [
        {
            timestamp: Date.UTC(2026, 6, 6) / 1000,
            label: "mon",
            build: { timestamp: 100 },
        },
        {
            timestamp: Date.UTC(2026, 6, 8) / 1000,
            label: "wed-map",
            build: { timestamp: 200 },
        },
        {
            timestamp: Date.UTC(2026, 6, 10) / 1000,
            label: "fri",
            build: { timestamp: 200 },
        },
        {
            timestamp: Date.UTC(2026, 6, 13) / 1000,
            label: "next-mon",
            build: { timestamp: 200 },
        },
    ];
    // Week of Mon 6 Jul has a map on Wed: that is the week's slot, Fri drops.
    // Next week contributes next-mon.
    const kept = selectDisplaySnapshots(snapshots, -Infinity, "week");
    assert.deepEqual(
        kept.map((sn) => sn.label),
        ["mon", "wed-map", "next-mon"],
    );
});

test("period timeline uses the map crawl as the week's slot", () => {
    const mon = Date.UTC(2026, 6, 6, 12);
    const wed = Date.UTC(2026, 6, 8, 12);
    const fri = Date.UTC(2026, 6, 10, 12);
    const timeline = periodUnionTimeline(
        [
            {
                source: "bitnodes",
                points: [
                    { ts: mon, value: 1 },
                    { ts: wed, value: 2 },
                    { ts: fri, value: 3 },
                ],
            },
        ],
        "week",
        { anchorTs: [wed] },
    );

    assert.deepEqual(timeline.timestamps, [wed]);
    assert.equal(timeline.valueAt("bitnodes", 0), 2);
});

test("days without a build change still collapse to the zoom grain", () => {
    const snapshots = [
        {
            timestamp: Date.UTC(2026, 5, 29) / 1000,
            label: "prev",
            build: { timestamp: 100 },
        },
        {
            timestamp: Date.UTC(2026, 6, 6) / 1000,
            label: "mon",
            build: { timestamp: 100 },
        },
        {
            timestamp: Date.UTC(2026, 6, 7) / 1000,
            label: "tue",
            build: { timestamp: 100 },
        },
        {
            timestamp: Date.UTC(2026, 6, 8) / 1000,
            label: "wed",
            build: { timestamp: 100 },
        },
    ];
    const kept = selectDisplaySnapshots(snapshots, -Infinity, "week");
    assert.deepEqual(
        kept.map((sn) => sn.label),
        ["prev", "mon"],
    );
});

test("monthly grain keeps builds and fills a quiet month between them", () => {
    // Builds in January and March; February has crawls but no new map → filler.
    const snapshots = [
        {
            timestamp: Date.UTC(2026, 0, 8) / 1000,
            label: "jan-map",
            build: { timestamp: 100 },
        },
        {
            timestamp: Date.UTC(2026, 0, 20) / 1000,
            label: "jan-later",
            build: { timestamp: 100 },
        },
        {
            timestamp: Date.UTC(2026, 1, 5) / 1000,
            label: "feb",
            build: { timestamp: 100 },
        },
        {
            timestamp: Date.UTC(2026, 1, 18) / 1000,
            label: "feb-later",
            build: { timestamp: 100 },
        },
        {
            timestamp: Date.UTC(2026, 2, 10) / 1000,
            label: "mar-map",
            build: { timestamp: 200 },
        },
    ];
    const kept = selectDisplaySnapshots(snapshots, -Infinity, "month");
    assert.deepEqual(
        kept.map((sn) => sn.label),
        ["jan-map", "feb", "mar-map"],
    );
});

test("min-gap thinning drops a filler that sits on a map point", () => {
    const snapshots = [
        {
            timestamp: Date.UTC(2026, 6, 2) / 1000, // Thu map
            label: "map",
            build: { timestamp: 200 },
        },
        {
            timestamp: Date.UTC(2026, 6, 5) / 1000, // Sun, same week
            label: "sun",
            build: { timestamp: 200 },
        },
        {
            timestamp: Date.UTC(2026, 6, 6) / 1000, // next Mon
            label: "next",
            build: { timestamp: 200 },
        },
    ];
    // First snapshot is always a build-change anchor; Sun is same week → dropped.
    const kept = selectDisplaySnapshots(snapshots, -Infinity, "week");
    assert.deepEqual(
        kept.map((sn) => sn.label),
        ["map", "next"],
    );
});

test("one-year staleness interpolates between surrounding builds", () => {
    const reading = stalenessAtTarget({
        points: [
            { age_days: 300, drift_pct: 3 },
            { age_days: 400, drift_pct: 5 },
        ],
    });

    assert.equal(reading.interpolated, true);
    assert.equal(reading.value, 4.3);
});

test("one-sided staleness scales the nearest build to one year", () => {
    const reading = stalenessAtTarget({
        points: [{ age_days: 100, drift_pct: 2 }],
    });

    assert.equal(reading.interpolated, false);
    assert.equal(reading.value, 7.3);
});
