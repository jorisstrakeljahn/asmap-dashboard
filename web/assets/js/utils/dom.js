// Tiny DOM helpers shared across components. Kept small on
// purpose: anything past a one-liner belongs in its component.

// XML namespace required by createElementNS for <svg> children.
// Lives here, not in symbols.js, because it's a DOM API constant
// rather than a rendered glyph.
export const SVG_NS = "http://www.w3.org/2000/svg";

let idCounter = 0;

// Page-wide unique id for ARIA wiring (aria-labelledby,
// aria-controls, aria-activedescendant). The ``prefix`` is just
// for human readability when inspecting the DOM in devtools.
export function uniqueId(prefix = "id") {
    idCounter += 1;
    return `${prefix}-${idCounter}`;
}

// Shared empty-state placeholder so muted styling stays consistent
// and a future markup tweak lives in one place.
export function mutedNote(text) {
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = text;
    return note;
}
