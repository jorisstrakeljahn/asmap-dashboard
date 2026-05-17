// Unicode text symbols the dashboard renders inline. Centralised
// so the same character is never typed by hand twice — drift
// between "→" written one way in one file and as an escape
// "\u2192" somewhere else used to make grep audits noisy.
//
// All values are the literal codepoint; consumers can read them
// directly without an extra unescape step. The names below match
// the Unicode chart wording (RIGHT, UP_RIGHT, ...) rather than
// the in-context semantics ("gained", "lost") so the constants
// stay usable across components that share the glyph for
// different meanings (e.g. RIGHT is both "A -> B" in the diff
// selector arrow and "→ unmapped" in the top-movers direction
// column).

// Directional arrows used by the diff selector ("A -> B") and
// the top-movers direction column ("→ unmapped", "↗ gained",
// "↘ lost", "↔ exchanged"). Same Unicode arrow family so all
// four glyphs share an optical baseline when rendered together.
export const ARROW = {
    RIGHT: "\u2192",
    UP_RIGHT: "\u2197",
    DOWN_RIGHT: "\u2198",
    LEFT_RIGHT: "\u2194",
};

// Typographic dashes / signs used in copy strings. The em-dash
// is the long form used between two clauses; the minus is the
// real Unicode minus (U+2212), which is visually heavier than
// the hyphen-minus on most fonts and reads correctly next to a
// "+" in delta lines.
export const EM_DASH = "\u2014";
export const MINUS = "\u2212";

// Misc symbols reused by the table chrome.
export const ELLIPSIS = "\u2026";
export const TIMES = "\u00d7";
export const CROSS = "\u2715";
