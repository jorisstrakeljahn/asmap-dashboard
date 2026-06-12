// Strings dictionary loaded from JSON at boot. t() / tPlural() do
// the lookup; applyDomTranslations() fills [data-i18n] elements.

let strings = {};
let locale = "en";
let pluralRules = null;

const FALLBACK_PLURAL = (count) => (count === 1 ? "one" : "other");

export async function loadStrings(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            console.warn(`i18n: ${url} returned HTTP ${response.status}`);
            return;
        }
        strings = (await response.json()) || {};
        locale = strings?._meta?.language || "en";
    } catch (error) {
        console.warn(`i18n: failed to load ${url}`, error);
    }
    pluralRules = makePluralRules(locale);
    if (typeof document !== "undefined" && document.documentElement) {
        document.documentElement.lang = locale;
    }
}

function makePluralRules(localeTag) {
    if (typeof Intl === "undefined" || typeof Intl.PluralRules !== "function") {
        return { select: FALLBACK_PLURAL };
    }
    try {
        return new Intl.PluralRules(localeTag);
    } catch {
        return { select: FALLBACK_PLURAL };
    }
}

// Misses return the key verbatim plus a console.warn so the UI
// stays alive and the gap is obvious on reload.
export function t(key, params) {
    const value = lookup(strings, key);
    if (value === undefined) {
        console.warn(`i18n: missing key "${key}"`);
        return key;
    }
    if (typeof value === "string") {
        return params ? interpolate(value, params) : value;
    }
    return value;
}

// Routes through Intl.PluralRules so non-English locales pick up
// "few" / "many" / etc. automatically. Falls back to ``other`` if
// the loaded dictionary lacks the selected category.
export function tPlural(key, count, params = {}) {
    const rules = pluralRules || makePluralRules(locale);
    const category = rules.select(count);
    const value =
        lookup(strings, `${key}.${category}`) ?? lookup(strings, `${key}.other`);
    if (typeof value === "string") {
        return interpolate(value, { count, ...params });
    }
    console.warn(`i18n: missing plural for "${key}" (count=${count})`);
    return `${key}.${category}`;
}

function lookup(root, key) {
    if (!key || typeof key !== "string") return undefined;
    let cur = root;
    for (const part of key.split(".")) {
        if (cur === null || typeof cur !== "object") return undefined;
        cur = cur[part];
        if (cur === undefined) return undefined;
    }
    return cur;
}

// Unknown placeholders survive literally so an editor's typo is
// visible instead of silently swallowed.
function interpolate(template, params) {
    return template.replace(/\{(\w+)\}/g, (match, name) => {
        if (Object.prototype.hasOwnProperty.call(params, name)) {
            return String(params[name]);
        }
        return match;
    });
}

// Localises static HTML at bootstrap. ``data-i18n="key"`` sets
// textContent; ``data-i18n-attr="attr:key,attr:key"`` sets one or
// more attributes from the same dictionary.
export function applyDomTranslations(root = document) {
    for (const el of root.querySelectorAll("[data-i18n]")) {
        const value = t(el.getAttribute("data-i18n"));
        if (typeof value === "string") el.textContent = value;
    }
    for (const el of root.querySelectorAll("[data-i18n-attr]")) {
        for (const pair of el.getAttribute("data-i18n-attr").split(",")) {
            const [attr, key] = pair.split(":").map((s) => s.trim());
            if (!attr || !key) continue;
            const value = t(key);
            if (typeof value === "string") el.setAttribute(attr, value);
        }
    }
}
