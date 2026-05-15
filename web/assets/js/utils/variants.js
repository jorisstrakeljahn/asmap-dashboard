// Shared variant-picking rules for the new metrics.json schema.
//
// Each maps[] entry carries two sub-objects, ``unfilled`` and
// ``filled``, with a ``present`` flag. ``unfilled`` is the canonical
// source of truth (filled can be derived from it deterministically;
// the reverse is not possible), so most surfaces should default to
// it and fall back to filled only when unfilled was not published.
// A handful of surfaces - file size, anything that asks "what does
// Bitcoin Core actually embed?" - prefer filled instead. Both
// orientations live here so the rule is named once and reused.
//
// All getters return ``null`` when no usable variant exists, which
// the caller can map to a "data unavailable" placeholder rather
// than rendering misleading zeros.

const UNFILLED = "unfilled";
const FILLED = "filled";

function isPresent(variant) {
    return Boolean(variant && variant.present);
}

// Default getter for "what should this card show?".
// Returns the unfilled profile when present, otherwise filled when
// present, otherwise null. The accompanying source is returned in
// the same call so the caller can label the data ("source data" vs
// "filled fallback") without having to re-derive which side won.
export function pickPreferUnfilled(map) {
    if (!map) return null;
    if (isPresent(map.unfilled)) {
        return { profile: map.unfilled, source: UNFILLED };
    }
    if (isPresent(map.filled)) {
        return { profile: map.filled, source: FILLED };
    }
    return null;
}

// Inverse of pickPreferUnfilled for the few surfaces that ask
// "what does Bitcoin Core embed?". File size and Bitcoin Core
// embedding-size charts use this orientation.
export function pickPreferFilled(map) {
    if (!map) return null;
    if (isPresent(map.filled)) {
        return { profile: map.filled, source: FILLED };
    }
    if (isPresent(map.unfilled)) {
        return { profile: map.unfilled, source: UNFILLED };
    }
    return null;
}

// Direct accessors when the caller knows it wants exactly one
// variant (e.g. the dual-line size chart needs both independently).
export function unfilledProfile(map) {
    return isPresent(map?.unfilled) ? map.unfilled : null;
}

export function filledProfile(map) {
    return isPresent(map?.filled) ? map.filled : null;
}

export const VARIANT_LABELS = {
    [UNFILLED]: "source data",
    [FILLED]: "filled (embedded)",
};
