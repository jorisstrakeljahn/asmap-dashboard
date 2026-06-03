// Diff Explorer tab: pick any two builds and inspect what
// changed between them — headline match rate, the three-bucket
// classification of entry-level changes, and the top movers
// table. Owns the section-header IPv4 / IPv6 family toggle and
// the diff explorer mount; the toggle re-renders results via
// the explorer's setFamily() handle so the picker behaves
// exactly like the History tab's drift unit picker.

import * as diffExplorer from "./components/diff-explorer.js";
import {
    createFamilyToggle,
    loadFamily,
    saveFamily,
} from "./components/diff-explorer/family.js";

/**
 * Mount the Diff Explorer tab panel.
 * @param {object} payload - parsed metrics.json contents.
 */
export function mount(payload) {
    let family = loadFamily();

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
