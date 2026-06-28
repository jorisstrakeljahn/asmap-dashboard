// Safe localStorage wrappers. Access throws in Safari private mode and when
// storage is disabled; every helper collapses the failure to the fallback.

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

// String setting with a whitelist guard. Returns ``fallback`` if storage is
// unavailable, the key is unset, or the value isn't allowed - the last case
// keeps a stale value from a removed picker option from leaking into the UI.
export function readSetting(key, allowed, fallback) {
    try {
        const raw = localStorage.getItem(key);
        if (raw !== null && allowed.includes(raw)) return raw;
        return fallback;
    } catch {
        return fallback;
    }
}

export function writeSetting(key, value) {
    try {
        localStorage.setItem(key, String(value));
    } catch {
        /* storage disabled */
    }
}
