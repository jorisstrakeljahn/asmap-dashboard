// Result region of the Diff Explorer: pulls together the
// match-rate banner, three-way classification breakdown, stacked
// bar, AS-roster delta, and the Top Movers table for a given
// (fromName, toName) pair.
//
// The pair lookup is direct because metrics.json stores every
// diff once with from < to and the selectors guarantee the same
// ordering on every render. A miss means the pair is genuinely
// absent from the payload (one side lacks an unfilled variant)
// and the caller falls back to unavailableMessage().

import { createInfoTooltip } from "../info-tooltip.js";
import * as topMoversTable from "../top-movers-table.js";
import {
    DIFF_RESULTS_INFO,
    classificationRow,
    matchBanner,
    rosterDeltaRow,
    stackedBar,
} from "./breakdown.js";

export function renderResults(parent, diffs, fromName, toName) {
    if (fromName === toName) {
        parent.replaceChildren(samePairMessage());
        return;
    }
    const diff = resolveDiff(diffs, fromName, toName);
    if (!diff) {
        parent.replaceChildren(unavailableMessage());
        return;
    }
    const card = document.createElement("article");
    card.className = "card diff-results";
    const explainer = createInfoTooltip({
        body: DIFF_RESULTS_INFO,
        ariaLabel: "About the diff classification",
    });
    explainer.classList.add("info-tooltip--card-corner");
    card.append(
        explainer,
        matchBanner(diff),
        classificationRow(diff),
        stackedBar(diff),
    );
    // AS roster delta sits one line below the stacked bar when
    // the payload carries the totals. Older payloads (regenerated
    // before the as_total_* fields landed) skip the row instead
    // of showing zeroes that would silently misrepresent the
    // data.
    const roster = rosterDeltaRow(diff);
    if (roster) card.append(roster);

    const topMoversSlot = document.createElement("div");
    topMoversTable.mount(topMoversSlot, diff);

    parent.replaceChildren(card, topMoversSlot);
}

function resolveDiff(diffs, fromName, toName) {
    return diffs.find((d) => d.from === fromName && d.to === toName) || null;
}

// Notice boxes share the .diff-explorer__notice scaffold (dashed
// border + centred text) plus .muted for the soft text colour.
// mutedNote() in utils/dom.js would only set .muted and lose the
// boxed look, so the helper lives locally instead.
function notice(text) {
    const node = document.createElement("p");
    node.className = "diff-explorer__notice muted";
    node.textContent = text;
    return node;
}

function samePairMessage() {
    return notice("Pick two different maps to see what changed.");
}

function unavailableMessage() {
    // The most common cause is one side of the pair not having
    // published an unfilled variant. Diffs are computed only
    // between builds that both ship unfilled (see metrics.py),
    // so an unfilled-only build silently drops out of the diff
    // timeline. Stating that explicitly avoids the "is this a
    // bug?" question.
    return notice(
        "No precomputed diff for this pair. One of the two builds is missing its unfilled (source data) variant.",
    );
}
