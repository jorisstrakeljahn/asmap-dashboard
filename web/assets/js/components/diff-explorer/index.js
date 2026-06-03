// Diff Explorer orchestrator: Map A / Map B selectors plus the
// rendered comparison. The IPv4 / IPv6 master family toggle
// lives in the section header (mounted by diff-tab.js) so it
// shares the same visual level as the History tab's drift unit
// and range pickers; the orchestrator only consumes the family
// value and re-renders results when it changes.
//
// Returned API exposes ``setFamily(family)`` so the section-
// header toggle can flip the active family without remounting
// the whole tab. mount() is otherwise side-effect-only.

import { mutedNote } from "../../utils/dom.js";
import { t } from "../../utils/i18n.js";
import { readPermalink, writePermalink } from "./permalink.js";
import { createSelectors } from "./selectors.js";
import { renderResults } from "./results.js";

export function mount(parent, payload, { family } = {}) {
    if (!payload.maps.length || !payload.diffs.length) {
        parent.replaceChildren(mutedNote(t("diff.noDiffsYet")));
        return { setFamily: () => {} };
    }

    // The pipeline only emits unfilled-vs-unfilled diffs, so
    // builds without an unfilled variant are permanently
    // un-diffable. Hide them entirely rather than disable; the
    // disabled state is reserved for the conditionally
    // impossible (A >= B) case that reacts to the other side.
    const diffableMaps = payload.maps.filter((m) => m.unfilled?.present);
    if (diffableMaps.length < 2) {
        parent.replaceChildren(mutedNote(t("diff.needTwoUnfilled")));
        return { setFamily: () => {} };
    }

    const root = document.createElement("div");
    root.className = "diff-explorer";

    const results = document.createElement("div");
    results.className = "diff-explorer__results";

    const nameToReleaseDate = new Map(
        diffableMaps.map((m) => [m.name, m.released_at]),
    );

    const state = { family, fromName: null, toName: null };

    const refresh = (fromName, toName) => {
        state.fromName = fromName;
        state.toName = toName;
        writePermalink(
            nameToReleaseDate.get(fromName),
            nameToReleaseDate.get(toName),
        );
        renderResults(results, payload.diffs, fromName, toName, state.family);
    };

    const selectors = createSelectors(diffableMaps, refresh);

    root.append(selectors.elem, results);
    parent.replaceChildren(root);

    const initial = resolveInitialSelection(diffableMaps);
    selectors.setSelection(initial.a, initial.b);

    return {
        setFamily(next) {
            if (state.family === next) return;
            state.family = next;
            if (state.fromName && state.toName) {
                renderResults(
                    results,
                    payload.diffs,
                    state.fromName,
                    state.toName,
                    state.family,
                );
            }
        },
    };
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
