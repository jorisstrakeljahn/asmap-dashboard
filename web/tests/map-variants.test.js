// "unfilled is the source of truth, filled is the fallback" is a rule every
// surface relies on; these lock the prefer-order and the present-guard.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    filledProfile,
    pickPreferUnfilled,
    unfilledProfile,
} from "../assets/js/utils/map-variants.js";

const present = (tag) => ({ present: true, tag });
const absent = { present: false };

test("prefers unfilled when present", () => {
    const map = { unfilled: present("u"), filled: present("f") };
    assert.deepEqual(pickPreferUnfilled(map), {
        profile: map.unfilled,
        source: "unfilled",
    });
});

test("falls back to filled when unfilled is absent", () => {
    const map = { unfilled: absent, filled: present("f") };
    assert.deepEqual(pickPreferUnfilled(map), {
        profile: map.filled,
        source: "filled",
    });
});

test("null when neither variant is present", () => {
    assert.equal(pickPreferUnfilled({ unfilled: absent, filled: absent }), null);
    assert.equal(pickPreferUnfilled(null), null);
});

test("a variant only counts when present is truthy", () => {
    assert.equal(unfilledProfile({ unfilled: absent }), null);
    assert.equal(unfilledProfile({ unfilled: present("u") }).tag, "u");
    assert.equal(filledProfile({}), null);
    assert.equal(unfilledProfile(null), null);
});
