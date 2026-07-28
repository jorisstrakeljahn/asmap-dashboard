// ASN attribution agreement: a single data-quality KPI, not a time
// series (it's a near-constant ~93%, so a flat chart added no signal).
// The headline reads off the latest independently WHOIS-annotated
// Bitnodes snapshot. Provider and coverage metadata make the comparison
// reproducible without exposing any node IPs.

import { html, nothing, render } from "../../vendor/lit-html.js";
import { t } from "../../utils/i18n.js";
import { crossCheckSummary } from "./quality-data.js";
import {
    attributionProviderLabel,
    latestLineageLabel,
} from "./series-data.js";

// Summarises the whole series, so it is range-independent and renders
// once. Snapshots without sufficient WHOIS coverage self-hide upstream.
export function mountCrossCheckStat(network, sources, primary) {
    const slot = document.querySelector("[data-network-crosscheck]");
    if (!slot) return;

    const summary = crossCheckSummary(network, sources, primary);
    // Never fall back to an annotated archive when the newest live snapshot
    // lacks WHOIS. lit owns the slot, so the empty case clears it.
    if (!summary) {
        render(nothing, slot);
        return;
    }

    // Pre-format so each string is the exact text content of its element.
    const labelText = t("network.crosscheck.label").toUpperCase();
    const metricText = t("network.crosscheck.metric", {
        pct: `${Math.round(summary.latest.cc.agreement_pct)}%`,
    });
    const noteText = t("network.crosscheck.note", {
        source: latestLineageLabel(network, primary),
        provider: attributionProviderLabel(network),
        coverage: `${(
            network.reality_attribution?.coverage_pct ?? 0
        ).toFixed(1)}%`,
        agreement: `${summary.latest.cc.agreement_pct.toFixed(1)}%`,
        compared: summary.latest.cc.compared.toLocaleString("en-US"),
    });

    render(
        html`
            <article class="card network-quality">
                <span class="card__label uppercase-label">${labelText}</span>
                <p class="card__metric">${metricText}</p>
                <p class="card__delta network-quality__note">${noteText}</p>
            </article>
        `,
        slot,
    );
}
