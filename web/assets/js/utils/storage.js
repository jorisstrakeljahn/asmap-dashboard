// Tiny try/catch wrapper around localStorage so component code
// can persist a setting without paying the same defensive
// boilerplate every time.
//
// Storage may be unavailable in Safari private mode or when the
// user disables cookies/storage, and accessing it throws rather
// than failing soft. Every helper here collapses the failure
// path to the supplied fallback so UI behaviour stays stable
// regardless of the underlying availability.
//
//   const showNames = readFlag("asmap.topMovers.showNames", true);
//   writeFlag("asmap.topMovers.showNames", false);
//
// JSON helpers are intentionally not provided yet: a callsite
// that needs more than a boolean today should declare its own
// (de)serialiser locally and we promote it here once a second
// caller wants the same shape, instead of speculating on a
// generic API.

// Boolean flag, persisted as the string "true" / "false". The
// fallback is returned both when the key is absent and when the
// stored value is anything else, so a hand-edited storage entry
// never poisons the UI into a never-toggled state.
export function readFlag(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        if (raw === "true") return true;
        if (raw === "false") return false;
        return fallback;
    } catch {
        return fallback;
    }
}

export function writeFlag(key, value) {
    try {
        localStorage.setItem(key, value ? "true" : "false");
    } catch {
        /* storage disabled — silently no-op */
    }
}
