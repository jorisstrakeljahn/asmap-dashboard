// Diff Explorer orchestrator: Map A / Map B selectors plus the
// rendered comparison.

import { mutedNote } from "../../utils/dom.js";
import { t } from "../../utils/i18n.js";
import { readPermalink, writePermalink } from "./permalink.js";
import { createSelectors } from "./selectors.js";
import { renderResults } from "./results.js";

export function mount(parent, payload) {
    if (!payload.maps.length || !payload.diffs.length) {
        parent.replaceChildren(mutedNote(t("diff.noDiffsYet")));
        return;
    }

    // The pipeline only emits unfilled-vs-unfilled diffs, so
    // builds without an unfilled variant are permanently
    // un-diffable. Hide them entirely rather than disable; the
    // disabled state is reserved for the conditionally
    // impossible (A >= B) case that reacts to the other side.
    const diffableMaps = payload.maps.filter((m) => m.unfilled?.present);
    if (diffableMaps.length < 2) {
        parent.replaceChildren(mutedNote(t("diff.needTwoUnfilled")));
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

// Honour a valid in-order URL hash; otherwise default to the
// two most recent builds.
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
