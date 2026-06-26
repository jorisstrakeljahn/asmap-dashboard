// Flat-config ESLint setup for the static web assets.
//
// The dashboard ships Vanilla JS / ES modules with no build step,
// so we lint the source tree directly. The rule set is small on
// purpose:
//
//   - js.configs.recommended catches real bugs (undefined names,
//     unused declarations, duplicate keys, etc.).
//   - no-unused-vars allows a leading underscore on parameter
//     names ("_unused") so callers can keep signature compatibility
//     without ESLint complaining.
//   - no-console is set to "warn" only for "log"; the dashboard
//     uses console.warn for graceful degradation (e.g. the
//     asn-names fetch fallback) which is genuine signal.
//
// Anything stricter than this lives in code review for now. The
// goal is a drive-by safety net, not a style police.

import js from "@eslint/js";
import globals from "globals";

export default [
    // Vendored third-party bundles (e.g. lit-html) are checked in as-is
    // and must not be reformatted or linted against our source rules.
    { ignores: ["web/assets/js/vendor/**"] },
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            globals: {
                ...globals.browser,
            },
        },
        rules: {
            "no-unused-vars": [
                "error",
                { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
            ],
            "no-console": ["warn", { allow: ["warn", "error"] }],
        },
    },
];
