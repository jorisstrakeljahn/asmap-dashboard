// "Real node impact" banner for a (fromName, toName) pair: how many observed
// nodes resolve to a different AS between the two maps, scored over the latest
// crawl's node set, grounding the abstract prefix diff in the live network.
// Optional data (in network.json, committed apart from the CI-regenerated diffs
// since it needs the non-public node set), so three states: no field -> render
// nothing; field but pair uncovered -> a muted note; covered -> the banner.
// Family-scoped to the master toggle.

import { html, render } from "../../vendor/lit-html.js";
import {
    FAMILY_IPV6,
    formatDate,
    formatNumber,
    formatPercent,
    glueUnits,
} from "../../format.js";
import { t } from "../../utils/i18n.js";
import { cloneSheetContext, createInfoTooltip } from "../info-tooltip.js";

// Returns the banner element, a muted "not available" note, or null (when the
// payload carries no node impact at all - stay invisible).
export function nodeImpactBanner(pairImpact, fromName, toName, family) {
    if (!pairImpact?.pairs) return null;
    const entry = pairImpact.pairs[`${fromName}|${toName}`];
    if (!entry) return notAvailableNote();

    const slice = family === FAMILY_IPV6 ? entry.families.ipv6 : entry.families.ipv4;
    if (!slice) return null;

    // The banner stays a real element so its info tooltip can clone the
    // banner's own figures for the mobile sheet header.
    const wrap = document.createElement("div");
    wrap.className = "node-impact";

    const tip = createInfoTooltip({
        body: t("diff.nodeImpact.info"),
        ariaLabel: t("diff.nodeImpact.infoAria"),
        // The mobile sheet leads with this banner's own figures (affected
        // share, counts, node-set source) so the reader keeps the context.
        sheetHeader: () => cloneSheetContext(wrap),
    });
    // Pulled out of the grid flow (absolute, top-right) so it does not claim a
    // column the headline / caption rows are laid out against.
    tip.classList.add("node-impact__info");

    const share = slice.total_nodes ? slice.total_affected / slice.total_nodes : 0;
    const caption = glueUnits(
        t("diff.nodeImpact.caption", {
            affected: formatNumber(slice.total_affected),
            total: formatNumber(slice.total_nodes),
        }),
    );
    const detail = glueUnits(
        t("diff.nodeImpact.detail", {
            reassigned: formatNumber(slice.reassigned),
            newlyMapped: formatNumber(slice.newly_mapped),
            unmapped: formatNumber(slice.unmapped),
        }),
    );
    const source = t("diff.nodeImpact.source", {
        source: (pairImpact.node_set_source || "").toUpperCase(),
        date: formatDate(pairImpact.node_set_label),
    });

    render(
        html`
            ${tip}
            <span class="node-impact__headline">${formatPercent(share, 1)}</span>
            <span class="node-impact__caption">${caption}</span>
            <span class="node-impact__detail">${detail}</span>
            <span class="node-impact__source">${source}</span>
        `,
        wrap,
    );
    return wrap;
}

function notAvailableNote() {
    return html`<p class="node-impact node-impact--empty muted">${t(
        "diff.nodeImpact.unavailable",
    )}</p>`;
}
