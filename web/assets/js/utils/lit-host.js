// Claim a container for lit's first render. lit's render() only manages the
// nodes after its own anchor comment, so a placeholder already in the slot - a
// static skeleton from index.html, or one injected while the data loaded -
// would be left sitting *above* the rendered content. Clearing the container
// the first time lit takes it over drops that placeholder; clearing again on a
// later pass would strand lit's anchor and render nothing, so we clear exactly
// once and remember it on the node.
//
// Returns true on the pass that cleared, false afterwards. Kept DOM-free (it
// only flips a flag and calls replaceChildren) so the clear-once contract is
// unit-testable without a document - see web/tests/lit-host.test.js.
export function claimContainer(container) {
    if (container.__litOwned) return false;
    container.replaceChildren();
    container.__litOwned = true;
    return true;
}
