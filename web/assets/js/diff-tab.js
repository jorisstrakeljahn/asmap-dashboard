// Diff Explorer tab: pick any two builds and inspect what
// changed between them — headline match rate, the three-bucket
// classification of entry-level changes, and the top movers
// table. Mirrors the Maps tab module shape (a single mount
// function called by app.js) so adding a third tab later is a
// copy-paste-and-fill exercise.

import * as diffExplorer from "./components/diff-explorer.js";

/**
 * Mount the Diff Explorer tab panel.
 * @param {object} payload - parsed metrics.json contents.
 */
export function mount(payload) {
    diffExplorer.mount(document.querySelector("[data-diff]"), payload);
}
