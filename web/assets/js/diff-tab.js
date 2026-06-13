// Diff Explorer tab: pick any two builds and inspect what
// changed between them — headline match rate, the three-bucket
// classification of entry-level changes, and the top movers
// table. Owns the section-header IPv4 / IPv6 family toggle and
// the diff explorer mount; the toggle re-renders results via
// the explorer's setFamily() handle so the picker behaves
// exactly like the History tab's drift unit picker.
//
// The tab's data (top-mover rosters) lives in the lazy-loaded
// diffs.json, so the tab paints in two beats: mountLoading() drops
// a layout-matching skeleton the instant the tab is first opened,
// then mount() swaps in the real explorer once diffs.json resolves
// (see app.js for the fetch orchestration). The swap is a plain
// replaceChildren — the same direct skeleton -> content handoff
// every other tab uses, so the Diff tab does not stand out with its
// own reveal animation.

import * as diffExplorer from "./components/diff-explorer.js";
import { createDiffSkeleton } from "./components/diff-explorer/skeleton.js";
import {
    createFamilyToggle,
    loadFamily,
    saveFamily,
} from "./components/diff-explorer/family.js";

/**
 * Paint the loading skeleton into the Diff tab. Called on the first
 * Diff-tab activation, before diffs.json is fetched: a layout-matching
 * placeholder in the body plus a pill placeholder for the family
 * toggle, so the header and body do not shift when the data lands.
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
        placeholder.className = "skeleton skel-bar skel-pill skel-pill--toggle";
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
