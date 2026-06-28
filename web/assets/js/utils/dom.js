// Tiny shared DOM helpers; anything past a one-liner belongs in its component.

import { render } from "../vendor/lit-html.js";
import { claimContainer } from "./lit-host.js";

// In utils, not symbols.js: a DOM API constant for createElementNS, not a glyph.
export const SVG_NS = "http://www.w3.org/2000/svg";

let idCounter = 0;

// Page-wide unique id for ARIA wiring; prefix is only for devtools readability.
export function uniqueId(prefix = "id") {
    idCounter += 1;
    return `${prefix}-${idCounter}`;
}

// Shared empty-state placeholder. Returns a DOM node, not a lit template, so
// both layers can consume it - `render(node, ...)` and `replaceChildren(node)`.
export function mutedNote(text) {
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = text;
    return note;
}

// Hand a container over to lit, clearing any one-time placeholder (a static
// skeleton from index.html, or one injected while the data was loading) the
// first time lit renders into it - see claimContainer for why. Later
// re-renders skip the clear and let lit reconcile in place.
export function renderInto(template, container) {
    claimContainer(container);
    render(template, container);
}

// Render a single-root lit template once and hand back the real element. Many
// widgets are built declaratively with lit, then owned imperatively from there
// (append / replaceChildren), so a throwaway holder is the one bridge between
// the two layers. The template must have exactly one element root - only the
// first element child is returned; lit's reactivity is dropped with the holder.
export function renderToElement(template) {
    const holder = document.createElement("div");
    render(template, holder);
    return holder.firstElementChild;
}
