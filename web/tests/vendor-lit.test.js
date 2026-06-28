// Drift guard for the vendored lit-html bundle. The committed copy, the
// package.json pin, and the curated header must all name the same version,
// or `npm run vendor:lit` has silently pulled a different build. Offline and
// dependency-free on purpose: it only reads files already in the repo.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel) =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const pinned = JSON.parse(read("../../package.json")).dependencies["lit-html"];
const bundle = read("../assets/js/vendor/lit-html.js");

test("the bundle self-reports the pinned version", () => {
    // lit-html registers itself: (globalThis.litHtmlVersions??=[]).push("X").
    const match = bundle.match(/litHtmlVersions[\s\S]*?push\("([^"]+)"\)/);
    assert.ok(match, "no litHtmlVersions push() found in the vendored bundle");
    assert.equal(match[1], pinned);
});

test("the curated header names the pinned version", () => {
    const escaped = pinned.replace(/\./g, "\\.");
    assert.match(bundle, new RegExp(`lit-html v${escaped}\\b`));
});
