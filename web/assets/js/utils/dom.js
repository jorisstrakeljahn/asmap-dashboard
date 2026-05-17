// Tiny DOM helpers shared across components.
//
// Kept deliberately small — anything bigger than a one-liner
// belongs in the component that uses it. The point of this
// module is to remove duplication, not to grow an abstraction.

// XML namespace required by createElementNS for every <svg> child
// element. Lives here (and not next to the text symbols in
// utils/symbols.js) because it is a DOM API constant, not a
// rendered glyph — the consumers are charts and icon-building
// components, all of which already import other DOM helpers from
// this module.
export const SVG_NS = "http://www.w3.org/2000/svg";

let idCounter = 0;

// Page-wide unique id for ARIA wiring (aria-labelledby,
// aria-controls, aria-activedescendant). The ``prefix`` is just
// for human readability when inspecting the DOM in devtools.
export function uniqueId(prefix = "id") {
    idCounter += 1;
    return `${prefix}-${idCounter}`;
}

// Standard "this component cannot render right now" placeholder.
// Bundled here so the empty-state copy across the dashboard is
// rendered with the same muted styling and a future style or
// markup tweak lives in one place.
export function mutedNote(text) {
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = text;
    return note;
}
