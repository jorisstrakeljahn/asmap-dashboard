// ASN attribution agreement: a single data-quality KPI, not a time
// series (it's a near-constant ~93%, so a flat chart added no signal).
// The headline reads off the primary crawl (KIT annotates every node
// with an ASN); the note widens it to the min/max band every scored
// source stays inside, so it reads as a cross-check, not one number.

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
    if (rows.length === 0) {
        slot.replaceChildren();
        return;
    }
    rows.sort((a, b) => b.ts - a.ts);

    const primaryRows = rows.filter((r) => r.source === primary);
    const latest = primaryRows[0] ?? rows[0];
    const values = rows.map((r) => r.cc.agreement_pct);
    const pct = `${Math.round(latest.cc.agreement_pct)}%`;

    const card = document.createElement("article");
    card.className = "card network-quality";

    const label = document.createElement("span");
    label.className = "card__label uppercase-label";
    label.textContent = t("network.crosscheck.label").toUpperCase();

    const metric = document.createElement("p");
    metric.className = "card__metric";
    metric.textContent = t("network.crosscheck.metric", { pct });

    const note = document.createElement("p");
    note.className = "card__delta network-quality__note";
    note.textContent = t("network.crosscheck.note", {
        source: sourceLabel(primary),
        min: `${Math.round(Math.min(...values))}%`,
        max: `${Math.round(Math.max(...values))}%`,
    });

    card.append(label, metric, note);
    slot.replaceChildren(card);
}
