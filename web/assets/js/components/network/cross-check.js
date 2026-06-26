// ASN attribution agreement: a single data-quality KPI, not a time
// series (it's a near-constant ~93%, so a flat chart added no signal).
// The headline reads off the primary crawl (KIT annotates every node
// with an ASN); the note widens it to the min/max band every scored
// source stays inside, so it reads as a cross-check, not one number.

import { html, nothing, render } from "../../vendor/lit-html.js";
import { t } from "../../utils/i18n.js";
import { sourceLabel, toMs } from "./series-data.js";

// Summarises the whole series, so it is range-independent and renders
// once. Scores every source that ships an ASN, so the agreement band
// cross-validates KIT against Bitnodes.
export function mountCrossCheckStat(network, sources, primary) {
    const slot = document.querySelector("[data-network-crosscheck]");
    if (!slot) return;

    // Every scored snapshot across all sources, newest first, so the
    // headline reads the latest primary figure and the note spans the
    // band across both crawlers.
    const rows = [];
    for (const source of sources) {
        for (const sn of network.sources[source].snapshots) {
            if (!sn.cross_check) continue;
            rows.push({ source, label: sn.label, ts: toMs(sn.timestamp), cc: sn.cross_check });
        }
    }
    // lit owns the slot, so the empty case clears it the same way the card path
    // fills it - one writer per node.
    if (rows.length === 0) {
        render(nothing, slot);
        return;
    }
    rows.sort((a, b) => b.ts - a.ts);

    const primaryRows = rows.filter((r) => r.source === primary);
    const latest = primaryRows[0] ?? rows[0];
    const values = rows.map((r) => r.cc.agreement_pct);

    // Pre-format so each string is the exact text content of its element.
    const labelText = t("network.crosscheck.label").toUpperCase();
    const metricText = t("network.crosscheck.metric", {
        pct: `${Math.round(latest.cc.agreement_pct)}%`,
    });
    const noteText = t("network.crosscheck.note", {
        source: sourceLabel(primary),
        min: `${Math.round(Math.min(...values))}%`,
        max: `${Math.round(Math.max(...values))}%`,
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
