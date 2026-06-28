// Top Movers sort + classification. directionRank() is the five-bucket logic
// that sort and filter share, so every bucket (incl. the "lost to unmapped
// pool" vs "lost to a real AS" split) gets a case. touchedRatio guards the
// divide-by-zero, and sortMovers must not mutate its input.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    compareMovers,
    directionRank,
    sortMovers,
    touchedRatio,
} from "../assets/js/components/top-movers/sort.js";
import { DRIFT_IPV4_COVERAGE } from "../assets/js/utils/diffs.js";

const UNIT = DRIFT_IPV4_COVERAGE;

const row = (fields) => ({
    ipv4_addresses_gained: 0,
    ipv4_addresses_lost: 0,
    ipv4_addresses_changed: 0,
    ipv4_addresses_in_a: 0,
    ipv4_addresses_in_b: 0,
    ipv4_primary_counterpart: 0,
    ...fields,
});

test("directionRank classifies every flow bucket", () => {
    assert.equal(directionRank(row({}), UNIT), 0); // inactive
    assert.equal(
        directionRank(row({ ipv4_addresses_gained: 5 }), UNIT),
        1,
    ); // gained
    assert.equal(
        directionRank(
            row({ ipv4_addresses_lost: 5, ipv4_primary_counterpart: 42 }),
            UNIT,
        ),
        2,
    ); // lost to a real AS
    assert.equal(
        directionRank(
            row({ ipv4_addresses_gained: 5, ipv4_addresses_lost: 3 }),
            UNIT,
        ),
        3,
    ); // exchanged
    assert.equal(
        directionRank(row({ ipv4_addresses_lost: 5 }), UNIT),
        4,
    ); // lost to the unmapped pool (no counterpart)
});

test("touchedRatio divides changes by the larger per-side presence", () => {
    assert.equal(
        touchedRatio(
            row({
                ipv4_addresses_changed: 30,
                ipv4_addresses_in_a: 100,
                ipv4_addresses_in_b: 60,
            }),
            UNIT,
        ),
        0.3,
    );
    // No presence => 0, never NaN.
    assert.equal(touchedRatio(row({ ipv4_addresses_changed: 5 }), UNIT), 0);
});

test("sortMovers returns a sorted copy without mutating the input", () => {
    const movers = [{ asn: 3 }, { asn: 1 }, { asn: 2 }].map((m) => row(m));
    const sorted = sortMovers(movers, "asn", "asc", UNIT);
    assert.deepEqual(
        sorted.map((m) => m.asn),
        [1, 2, 3],
    );
    // Original order is untouched.
    assert.deepEqual(
        movers.map((m) => m.asn),
        [3, 1, 2],
    );
});

test("compareMovers flips sign with direction", () => {
    const a = row({ asn: 1 });
    const b = row({ asn: 2 });
    assert.ok(compareMovers(a, b, "asn", "asc", UNIT) < 0);
    assert.ok(compareMovers(a, b, "asn", "desc", UNIT) > 0);
    assert.equal(compareMovers(a, b, "unknown-field", "asc", UNIT), 0);
});
