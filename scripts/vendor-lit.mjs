// Refresh the vendored lit-html bundle (web/assets/js/vendor/lit-html.js).
//
// The dashboard has no build step and must keep working offline / over
// file://, so it ships a committed copy of lit-html rather than pulling a
// CDN at runtime. This script re-fetches the exact pinned build, strips the
// jsDelivr-only sourceMappingURL so nothing points off-repo, and re-prepends
// the curated note verbatim.
//
// The version comes from package.json ("dependencies".lit-html) - the single
// pin - and the fetched bundle is verified to self-report that same version
// before anything is written, so a re-vendor can't silently drift. To upgrade:
// bump the pin in package.json, run `npm run vendor:lit`, then bump the
// version + date in the note at the top of the vendored file by hand.
//
//   npm run vendor:lit

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const VENDOR_PATH = fileURLToPath(
    new URL("../web/assets/js/vendor/lit-html.js", import.meta.url),
);
const PACKAGE_PATH = fileURLToPath(new URL("../package.json", import.meta.url));

// The upstream bundle starts with this jsDelivr banner; everything before it
// in the committed file is our hand-written note, which we keep as-is.
const UPSTREAM_MARKER = "/**\n * Bundled by jsDelivr";

async function main() {
    const pkg = JSON.parse(await readFile(PACKAGE_PATH, "utf8"));
    const version = pkg.dependencies?.["lit-html"];
    if (!version) {
        throw new Error('No "dependencies".lit-html pin found in package.json.');
    }
    const sourceUrl = `https://cdn.jsdelivr.net/npm/lit-html@${version}/+esm`;

    const current = await readFile(VENDOR_PATH, "utf8");
    const markerAt = current.indexOf(UPSTREAM_MARKER);
    if (markerAt === -1) {
        throw new Error(
            `Could not find the upstream banner in ${VENDOR_PATH}; refusing ` +
                "to overwrite so the curated header is never lost.",
        );
    }
    const header = current.slice(0, markerAt);

    const response = await fetch(sourceUrl);
    if (!response.ok) {
        throw new Error(`Failed to fetch ${sourceUrl}: HTTP ${response.status}`);
    }
    const upstream = await response.text();

    // Verify the bundle self-reports the pinned version before writing, so a
    // tag/registry surprise can never overwrite the copy with a different one.
    const reported = upstream.match(/litHtmlVersions[\s\S]*?push\("([^"]+)"\)/);
    if (!reported || reported[1] !== version) {
        throw new Error(
            `Fetched bundle reports version ${reported?.[1] ?? "unknown"}, ` +
                `expected ${version} (the package.json pin). Aborting.`,
        );
    }

    // Drop the sourceMappingURL line: it resolves only on jsDelivr, so a
    // committed copy must not reference it.
    const stripped = upstream
        .split("\n")
        .filter((line) => !line.includes("sourceMappingURL"))
        .join("\n")
        .trimEnd();

    await writeFile(VENDOR_PATH, `${header}${stripped}\n`, "utf8");
    console.log(
        `Refreshed ${VENDOR_PATH} from ${sourceUrl} (lit-html ${version}).\n` +
            "Now bump the version + date in the note at the top of that file.",
    );
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
