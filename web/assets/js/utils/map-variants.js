// Variant selection rules. ``unfilled`` is the canonical source
// of truth (filled can be derived from it, not vice versa), so
// most surfaces default to unfilled and fall back to filled.
// The few "what does Bitcoin Core embed?" surfaces invert that.

const UNFILLED = "unfilled";
const FILLED = "filled";

function isPresent(variant) {
    return Boolean(variant && variant.present);
}

// Returns { profile, source } so the caller can label the data
// ("source data" vs "filled fallback") without re-deriving which
// side won. ``null`` when neither variant is present.
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
