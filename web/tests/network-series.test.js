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
    clampTimeline,
    dayUnionTimeline,
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
