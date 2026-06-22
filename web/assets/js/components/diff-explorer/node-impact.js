// "Real node impact" banner for a (fromName, toName) pair: how many
// observed nodes resolve to a different AS between the two maps,
// scored over the most recent crawl's node set. Grounds the abstract
// prefix diff in the live network.
//
// Optional data, in network.json (committed separately from the
// CI-regenerated diffs because it needs the non-public node set), so
// three states are handled:
//   - no network.json / payload predates the field -> render nothing
//   - field exists but this pair is not covered    -> a muted note
//   - covered                                      -> the banner
//
// Family-scoped to match the Diff Explorer master toggle.

import {
    FAMILY_IPV6,
    formatDate,
    formatNumber,
    formatPercent,
    glueUnits,
} from "../../format.js";
import { t } from "../../utils/i18n.js";
import { cloneSheetContext, createInfoTooltip } from "../info-tooltip.js";

// Returns the banner element, a muted "not available" note, or null
// (when the payload carries no node impact at all — stay invisible).
export function nodeImpactBanner(pairImpact, fromName, toName, family) {
    if (!pairImpact?.pairs) return null;
    const entry = pairImpact.pairs[`${fromName}|${toName}`];
    if (!entry) return notAvailableNote();

    const slice = family === FAMILY_IPV6 ? entry.families.ipv6 : entry.families.ipv4;
    if (!slice) return null;

    const wrap = document.createElement("div");
    wrap.className = "node-impact";

    const tip = createInfoTooltip({
        body: t("diff.nodeImpact.info"),
        ariaLabel: t("diff.nodeImpact.infoAria"),
        // On a phone the explanation opens as a bottom-sheet; lead it with
        // this banner's own figures (the affected share, the counts and the
        // node-set source) so the reader keeps the context.
        sheetHeader: () => cloneSheetContext(wrap),
    });
    // Pulled out of the grid flow (absolute, top-right) so it does not
    // claim a column the headline / caption rows are laid out against.
    tip.classList.add("node-impact__info");

    const headline = document.createElement("span");
    headline.className = "node-impact__headline";
    const share = slice.total_nodes ? slice.total_affected / slice.total_nodes : 0;
    headline.textContent = formatPercent(share, 1);

    const caption = document.createElement("span");
    caption.className = "node-impact__caption";
    caption.textContent = glueUnits(
        t("diff.nodeImpact.caption", {
            affected: formatNumber(slice.total_affected),
            total: formatNumber(slice.total_nodes),
        }),
    );

    const detail = document.createElement("span");
    detail.className = "node-impact__detail";
    detail.textContent = glueUnits(
        t("diff.nodeImpact.detail", {
            reassigned: formatNumber(slice.reassigned),
            newlyMapped: formatNumber(slice.newly_mapped),
            unmapped: formatNumber(slice.unmapped),
        }),
    );

    const source = document.createElement("span");
    source.className = "node-impact__source";
    source.textContent = t("diff.nodeImpact.source", {
        source: (pairImpact.node_set_source || "").toUpperCase(),
        date: formatDate(pairImpact.node_set_label),
    });

    wrap.append(tip, headline, caption, detail, source);
    return wrap;
}

function notAvailableNote() {
    const note = document.createElement("p");
    note.className = "node-impact node-impact--empty muted";
    note.textContent = t("diff.nodeImpact.unavailable");
    return note;
}
