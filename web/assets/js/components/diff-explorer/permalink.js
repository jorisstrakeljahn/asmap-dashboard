// Sharable Map A / Map B permalink: ``#diff?a=YYYY-MM-DD&b=YYYY-MM-DD``. Dates
// rather than internal names so the URL stays readable when pasted into a PR
// comment. The generic per-tab hash machinery lives in utils/hash-state.js;
// this is the diff tab's thin adapter over it.

import { readHashState, writeHashState } from "../../utils/hash-state.js";

const TAB = "diff";

export function readPermalink() {
    const params = readHashState(TAB);
    return { a: params.get("a"), b: params.get("b") };
}

export function writePermalink(aDate, bDate) {
    writeHashState(TAB, { a: aDate, b: bDate });
}
