// Composes match banner + classification breakdown + stacked bar + roster delta
// + Top Movers table for a (fromName, toName) pair. metrics.json stores every
// diff once with from < to; the selectors guarantee the same ordering, so the
// lookup is direct.

import { html, render } from "../../vendor/lit-html.js";
import { t } from "../../utils/i18n.js";
import { findDirectionalDiff } from "../../utils/diffs.js";
import { cloneSheetContext, createInfoTooltip } from "../info-tooltip.js";
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
        render(notice(t("diff.results.samePair")), parent);
        return;
    }
    const diff = findDirectionalDiff(diffs, fromName, toName);
    if (!diff) {
        render(notice(t("diff.results.unavailable")), parent);
        return;
    }

    // The card stays a real element so the corner explainer can clone its
    // headline breakdown for the mobile sheet; lit fills the children.
    const card = document.createElement("article");
    card.className = "card diff-results";
    const explainer = createInfoTooltip({
        body: t("diff.results.info"),
        ariaLabel: t("diff.results.infoAria"),
        // Mobile sheet leads with the headline breakdown this text describes.
        // The roster-delta line and node-impact banner carry their own "i", so
        // they're excluded here.
        sheetHeader: () =>
            cloneSheetContext(card, { exclude: [".as-roster-delta", ".node-impact"] }),
    });
    explainer.classList.add("info-tooltip--card-corner");
    // rosterDeltaRow closes the map-level picture right after the prefix
    // breakdown; nodeImpactBanner sits last - what the diff means for live
    // peers. Both yield nothing when their data is absent.
    render(
        html`
            ${explainer}
            ${matchBanner(diff, family)}
            ${classificationRow(diff, family)}
            ${stackedBar(diff, family)}
            ${rosterDeltaRow(diff)}
            ${nodeImpactBanner(pairImpact, fromName, toName, family)}
        `,
        card,
    );

    const topMoversSlot = document.createElement("div");
    topMoversTable.mount(topMoversSlot, diff, { family });

    render(html`${card}${topMoversSlot}`, parent);
}

// Local helper instead of mutedNote() so the dashed-border notice scaffold
// stays consistent with the rest of the card.
function notice(text) {
    return html`<p class="diff-explorer__notice muted">${text}</p>`;
}
