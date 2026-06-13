// Composes match banner + classification breakdown + stacked
// bar + roster delta + Top Movers table for a (fromName, toName)
// pair. metrics.json stores every diff once with from < to; the
// selectors guarantee the same ordering, so the lookup is direct.

import { t } from "../../utils/i18n.js";
import { findDirectionalDiff } from "../../utils/diffs.js";
import { createInfoTooltip } from "../info-tooltip.js";
import * as topMoversTable from "../top-movers-table.js";
import {
    classificationRow,
    matchBanner,
    rosterDeltaRow,
    stackedBar,
} from "./breakdown.js";
import { nodeImpactBanner } from "./node-impact.js";

export function renderResults(
    parent,
    diffs,
    fromName,
    toName,
    family,
    { pairImpact = null } = {},
) {
    if (fromName === toName) {
        parent.replaceChildren(samePairMessage());
        return;
    }
    const diff = findDirectionalDiff(diffs, fromName, toName);
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
        matchBanner(diff, family),
        classificationRow(diff, family),
        stackedBar(diff, family),
    );
    // AS roster delta closes the map-level picture (how many distinct
    // ASes each build maps) right after the prefix breakdown it belongs
    // with, as its own divided line.
    const roster = rosterDeltaRow(diff);
    if (roster) card.append(roster);
    // Optional "real node impact" line, only when network.json shipped
    // node-impact data. Sits last because it answers the downstream
    // question — what the diff means for live peers — that the
    // map-level breakdown above it cannot.
    const impact = nodeImpactBanner(pairImpact, fromName, toName, family);
    if (impact) card.append(impact);

    const topMoversSlot = document.createElement("div");
    topMoversTable.mount(topMoversSlot, diff, { family });

    parent.replaceChildren(card, topMoversSlot);
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
