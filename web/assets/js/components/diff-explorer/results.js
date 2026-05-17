// Composes match banner + classification breakdown + stacked
// bar + roster delta + Top Movers table for a (fromName, toName)
// pair. metrics.json stores every diff once with from < to; the
// selectors guarantee the same ordering, so the lookup is direct.

import { t } from "../../utils/i18n.js";
import { createInfoTooltip } from "../info-tooltip.js";
import * as topMoversTable from "../top-movers-table.js";
import {
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
        body: t("diff.results.info"),
        ariaLabel: t("diff.results.infoAria"),
    });
    explainer.classList.add("info-tooltip--card-corner");
    card.append(
        explainer,
        matchBanner(diff),
        classificationRow(diff),
        stackedBar(diff),
    );
    const roster = rosterDeltaRow(diff);
    if (roster) card.append(roster);

    const topMoversSlot = document.createElement("div");
    topMoversTable.mount(topMoversSlot, diff);

    parent.replaceChildren(card, topMoversSlot);
}

function resolveDiff(diffs, fromName, toName) {
    return diffs.find((d) => d.from === fromName && d.to === toName) || null;
}

// Local helper instead of mutedNote() so the dashed-border
// notice scaffold stays consistent with the rest of the card.
function notice(text) {
    const node = document.createElement("p");
    node.className = "diff-explorer__notice muted";
    node.textContent = text;
    return node;
}

function samePairMessage() {
    return notice(t("diff.results.samePair"));
}

function unavailableMessage() {
    return notice(t("diff.results.unavailable"));
}
