// ASN attribution agreement: a single data-quality KPI plus an
// explanatory sentence rather than a time series (the agreement is a
// near-constant ~93%, so a flat two-line chart added no signal and its
// Bitnodes gap read as a bug). The headline reads off the primary crawl
// (KIT annotates every node with an ASN), but a disclosure exposes the
// exact per-snapshot counts for every scored source, so the figure is
// checkable rather than asserted.

import { formatDate, formatNumber } from "../../format.js";
import { t } from "../../utils/i18n.js";
import { createInfoTooltip } from "../info-tooltip.js";
import { sourceLabel, toMs } from "./series-data.js";

// The data-quality stat summarises the whole series, so it is not
// range-dependent and renders once. It scores every source that ships
// an ASN, not just the primary, so the disclosure table can
// cross-validate KIT against Bitnodes.
export function mountCrossCheckStat(network, sources, primary) {
    const slot = document.querySelector("[data-network-crosscheck]");
    if (!slot) return;

    // Every scored snapshot across all sources, newest first, for the
    // disclosure table and the agreement band.
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

    const info = createInfoTooltip({
        body: t("network.crosscheck.info"),
        ariaLabel: t("network.crosscheck.infoAria"),
    });
    info.classList.add("info-tooltip--card-corner");
    card.append(info);

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
        pct,
        date: formatDate(latest.label),
        min: `${Math.round(Math.min(...values))}%`,
        max: `${Math.round(Math.max(...values))}%`,
    });

    card.append(label, metric, note, crossCheckTable(rows));
    slot.replaceChildren(card);
}

// Disclosure ("switch button") holding the raw per-snapshot counts the
// headline is derived from: date, source, compared, agree, agreement %.
// A native <details> keeps it keyboard-accessible and closed by default
// so the card stays compact until the reader wants to verify.
function crossCheckTable(rows) {
    const details = document.createElement("details");
    details.className = "network-quality__details";

    const summary = document.createElement("summary");
    summary.className = "network-quality__summary";
    summary.textContent = t("network.crosscheck.tableToggle");
    details.append(summary);

    const wrap = document.createElement("div");
    wrap.className = "network-quality__table-wrap";

    const table = document.createElement("table");
    table.className = "network-quality__table";

    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const key of ["colSnapshot", "colSource", "colCompared", "colAgree", "colAgreement"]) {
        const th = document.createElement("th");
        th.textContent = t(`network.crosscheck.${key}`);
        if (key !== "colSnapshot" && key !== "colSource") th.classList.add("is-num");
        headRow.append(th);
    }
    head.append(headRow);

    const body = document.createElement("tbody");
    for (const row of rows) {
        const tr = document.createElement("tr");
        tr.append(
            cell(formatDate(row.label)),
            cell(sourceLabel(row.source)),
            cell(formatNumber(row.cc.compared), true),
            cell(formatNumber(row.cc.agree), true),
            cell(`${row.cc.agreement_pct.toFixed(1)}%`, true),
        );
        body.append(tr);
    }

    table.append(head, body);
    wrap.append(table);
    details.append(wrap);
    return details;
}

function cell(text, numeric = false) {
    const td = document.createElement("td");
    td.textContent = text;
    if (numeric) td.classList.add("is-num");
    return td;
}
