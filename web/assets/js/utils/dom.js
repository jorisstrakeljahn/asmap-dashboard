// Tiny DOM helpers shared across components.
//
// Kept deliberately small — anything bigger than a one-liner
// belongs in the component that uses it. The point of this
// module is to remove duplication, not to grow an abstraction.

let idCounter = 0;

// Page-wide unique id for ARIA wiring (aria-labelledby,
// aria-controls, aria-activedescendant). The ``prefix`` is just
// for human readability when inspecting the DOM in devtools.
export function uniqueId(prefix = "id") {
    idCounter += 1;
    return `${prefix}-${idCounter}`;
}
