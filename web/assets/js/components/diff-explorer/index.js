// Diff Explorer orchestrator: Map A / Map B selectors plus the rendered
// comparison. The IPv4/IPv6 master toggle lives in the section header (mounted
// by diff-tab.js); this only consumes the family value and re-renders on
// change. setFamily(family) flips it without remounting; mount() is otherwise
// side-effect-only.

import { html } from "../../vendor/lit-html.js";
import { mutedNote, renderInto } from "../../utils/dom.js";
import { t } from "../../utils/i18n.js";
import { readPermalink, writePermalink } from "./permalink.js";
import { createSelectors } from "./selectors.js";
import { renderResults } from "./results.js";

export function mount(parent, payload, { family } = {}) {
    if (!payload.maps.length || !payload.diffs.length) {
        renderInto(mutedNote(t("diff.noDiffsYet")), parent);
        return { setFamily: () => {} };
    }

    // The pipeline only emits unfilled-vs-unfilled diffs, so builds without an
    // unfilled variant are permanently un-diffable: hide them rather than
    // disable (the disabled state is reserved for the conditional A >= B case).
    const diffableMaps = payload.maps.filter((m) => m.unfilled?.present);
    if (diffableMaps.length < 2) {
        renderInto(mutedNote(t("diff.needTwoUnfilled")), parent);
        return { setFamily: () => {} };
    }

    const results = document.createElement("div");
    results.className = "diff-explorer__results";

    const nameToReleaseDate = new Map(
        diffableMaps.map((m) => [m.name, m.released_at]),
    );

    const state = { family, fromName: null, toName: null };

    // The default comparison is the two most recent builds; that view needs
    // nothing in the URL, so only a non-default pair gets a sharable hash.
    const defaultFromName = diffableMaps.at(-2).name;
    const defaultToName = diffableMaps.at(-1).name;

    const refresh = (fromName, toName) => {
        state.fromName = fromName;
        state.toName = toName;
        const isDefaultPair =
            fromName === defaultFromName && toName === defaultToName;
        writePermalink(
            isDefaultPair ? null : nameToReleaseDate.get(fromName),
            isDefaultPair ? null : nameToReleaseDate.get(toName),
        );
        renderResults(results, payload.diffs, fromName, toName, state.family, {
            pairImpact: payload.pairImpact,
        });
    };

    const selectors = createSelectors(diffableMaps, refresh);

    renderInto(
        html`<div class="diff-explorer">${selectors.elem}${results}</div>`,
        parent,
    );

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
                    { pairImpact: payload.pairImpact },
                );
            }
        },
    };
}

// Honour a valid in-order URL hash; otherwise default to the two most recent
// builds.
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
