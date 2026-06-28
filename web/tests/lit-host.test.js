// The clear-once contract behind renderInto(): the first lit render into a slot
// must drop the placeholder skeleton sitting there, and every render after that
// must leave it alone (clearing again would strand lit's anchor and paint
// nothing). Both halves regressed real layouts - a skeleton stacked above the
// Maps overview, Network hero, Diff Explorer, and over the build picker - so
// this pins the gate. DOM-free: a stub container with a replaceChildren spy is
// all claimContainer touches, so this stays in the pure suite (no document).

import { test } from "node:test";
import assert from "node:assert/strict";

import { claimContainer } from "../assets/js/utils/lit-host.js";

const stubContainer = () => ({
    clears: 0,
    replaceChildren() {
        this.clears += 1;
    },
});

test("the first claim clears the placeholder and takes ownership", () => {
    const container = stubContainer();
    const cleared = claimContainer(container);
    assert.equal(cleared, true);
    assert.equal(container.clears, 1);
    assert.equal(container.__litOwned, true);
});

test("later claims never clear again, so lit's anchor is not stranded", () => {
    const container = stubContainer();
    claimContainer(container);
    assert.equal(claimContainer(container), false);
    assert.equal(claimContainer(container), false);
    assert.equal(container.clears, 1);
});

test("a container already owned by lit is left untouched", () => {
    const container = stubContainer();
    container.__litOwned = true;
    assert.equal(claimContainer(container), false);
    assert.equal(container.clears, 0);
});
