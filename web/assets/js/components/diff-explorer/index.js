// Diff Explorer orchestrator: Map A / Map B selectors plus the
// rendered comparison (match-rate banner, three-way
// classification breakdown, stacked bar, AS roster delta, and
// the Top Movers table).
//
// Submodules:
//   permalink.js  — sharable URL hash (read + write)
//   selectors.js  — Map A / Map B selector pair with strict ordering
//   breakdown.js  — match banner, classification cells, stacked bar
//   results.js    — pulls the above together for a given (A, B) pair

import { mutedNote } from "../../utils/dom.js";
import { readPermalink, writePermalink } from "./permalink.js";
import { createSelectors } from "./selectors.js";
import { renderResults } from "./results.js";

export function mount(parent, payload) {
    if (!payload.maps.length || !payload.diffs.length) {
        parent.replaceChildren(mutedNote("metrics.json contains no diffs yet."));
        return;
    }

    // Only builds that published an unfilled (source-data)
    // variant can participate in a diff: the pipeline computes
    // diffs from unfilled-vs-unfilled exclusively, so a build
    // without an unfilled .dat is guaranteed to have zero
    // matching diff entries. We hide such builds from the
    // selectors entirely rather than greying them out, because
    // the disabled state in the dropdown is reserved for
    // *conditionally* impossible pairs (A >= B) that react when
    // the user moves the other side. A build without an unfilled
    // variant is permanently impossible to diff, so a
    // permanently-greyed row would be a UX dead-end. If the
    // upstream backfills an unfilled variant later, the build
    // re-appears automatically the next run.
    const diffableMaps = payload.maps.filter((m) => m.unfilled?.present);
    if (diffableMaps.length < 2) {
        parent.replaceChildren(
            mutedNote(
                "Need at least two builds with an unfilled variant to compare.",
            ),
        );
        return;
    }

    const root = document.createElement("div");
    root.className = "diff-explorer";

    const results = document.createElement("div");
    results.className = "diff-explorer__results";

    const nameToReleaseDate = new Map(
        diffableMaps.map((m) => [m.name, m.released_at]),
    );

    const refresh = (fromName, toName) => {
        writePermalink(
            nameToReleaseDate.get(fromName),
            nameToReleaseDate.get(toName),
        );
        renderResults(results, payload.diffs, fromName, toName);
    };

    const selectors = createSelectors(diffableMaps, refresh);

    root.append(selectors.elem, results);
    parent.replaceChildren(root);

    const initial = resolveInitialSelection(diffableMaps);
    selectors.setSelection(initial.a, initial.b);
}

// Pick the initial Map A / Map B pair on mount. If the URL hash
// names a valid, in-order pair we honour it; otherwise we fall
// back to the two most recent builds, which is the most common
// "show me the latest diff" landing experience.
function resolveInitialSelection(maps) {
    const fallback = {
        a: maps.at(-2).name,
        b: maps.at(-1).name,
    };
    const { a: requestedA, b: requestedB } = readPermalink();
    if (!requestedA || !requestedB) return fallback;
    const aIdx = maps.findIndex((m) => m.released_at === requestedA);
    const bIdx = maps.findIndex((m) => m.released_at === requestedB);
    if (aIdx < 0 || bIdx < 0 || aIdx >= bIdx) return fallback;
    return { a: maps[aIdx].name, b: maps[bIdx].name };
}
