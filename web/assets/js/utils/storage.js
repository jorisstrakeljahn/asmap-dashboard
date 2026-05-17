// Safe localStorage wrappers. Access throws in Safari private
// mode and when storage is disabled; every helper here collapses
// the failure path to the supplied fallback.

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
        /* storage disabled */
    }
}
