// Diff Explorer tab: pick any two builds and inspect what changed —
// match rate, the three-bucket classification of entry-level changes,
// and the top movers table. Owns the IPv4 / IPv6 family toggle, which
// re-renders via the explorer's setFamily() handle.
//
// The tab's data (top-mover rosters) lives in lazy-loaded diffs.json,
// so it paints in two beats: mountLoading() drops a layout-matching
// skeleton on first open, then mount() swaps in the real explorer once
// diffs.json resolves (fetch orchestration in app.js). The swap is a
// plain replaceChildren, like every other tab.

import * as diffExplorer from "./components/diff-explorer.js";
import { createDiffSkeleton } from "./components/diff-explorer/skeleton.js";
import {
    createFamilyToggle,
    loadFamily,
    saveFamily,
} from "./components/diff-explorer/family.js";

/**
 * Paint the loading skeleton into the Diff tab. Called on first
 * activation, before diffs.json is fetched: a layout-matching body
 * placeholder plus a pill for the family toggle, so nothing shifts
 * when the data lands.
 */
export function mountLoading() {
    const body = document.querySelector("[data-diff]");
    if (body) {
        const skeleton = createDiffSkeleton({ family: loadFamily() });
        skeleton.setAttribute("aria-hidden", "true");
        body.replaceChildren(skeleton);
    }

    const familySlot = document.querySelector("[data-diff-family]");
    if (familySlot) {
        const placeholder = document.createElement("span");
        placeholder.className = "skeleton skeleton__bar skeleton__pill skeleton__pill--toggle";
        placeholder.setAttribute("aria-hidden", "true");
        familySlot.replaceChildren(placeholder);
    }
}

/**
 * Mount the Diff Explorer tab panel.
 * @param {object} payload - merged diff payload (summaries + rosters).
 */
export function mount(payload) {
    let family = loadFamily();

    // diffExplorer.mount() does replaceChildren on the slot, so this
    // swaps the skeleton out for the live explorer in one step.
    const explorer = diffExplorer.mount(
        document.querySelector("[data-diff]"),
        payload,
        { family },
    );

    const familySlot = document.querySelector("[data-diff-family]");
    if (familySlot) {
        const toggle = createFamilyToggle(family, (next) => {
            family = next;
            saveFamily(next);
            explorer.setFamily(next);
        });
        familySlot.replaceChildren(toggle);
    }
}
