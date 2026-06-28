// Shared chrome for header-bearing chart cards: card shell, optional header
// (title + lede + optional control), optional legend, and a plot slot that
// delegates the responsive SVG to mountResponsiveChart. Used by the Network
// series charts, the top-operator breakdown, and the Maps drift chart.
//
// On re-render into the same slot the card is kept and only legend + plot swap,
// so a header control (a mode switch) is never re-parented - that would reset
// its in-flight pill transition. headerExtra identity scopes the reuse (charts
// without one compare null === null and reuse too).

import { mountResponsiveChart } from "./chart-base.js";
import { createChartLede } from "../components/chart-lede.js";

// Mount (or re-render into) a header-bearing chart card under `parent`, and
// return the mountResponsiveChart handle so a clickable legend can rerender().
//
//   title:       card label (rendered upper-cased)
//   subtitle:    secondary label beside the title; changing it rebuilds header
//   lede:        always-visible summary below the header, optional
//   headerExtra: Element beside the headline (e.g. a mode switch); its identity
//                gates card reuse
//   legend:      pre-built legend Element above the plot, optional
//   drawPlot:    ({ width, height, layout }) -> Element, the plot body
//   cardClass:   extra class(es) for the <article>, optional
//   layout:      mountResponsiveChart layout overrides, optional
export function mountTimeSeriesCard(parent, config) {
    if (!parent) return undefined;
    const {
        title,
        subtitle = null,
        lede = null,
        headerExtra = null,
        legend = null,
        drawPlot,
        cardClass = "",
        layout = {},
    } = config;

    // Reuse only when header content is unchanged (same title, subtitle, and
    // the very same headerExtra element), so a header control isn't re-parented
    // (which resets its pill transition). A changed subtitle rebuilds.
    const existing = parent.firstElementChild;
    const reused =
        existing &&
        existing.classList.contains("chart-card") &&
        existing.__title === title &&
        existing.__subtitle === subtitle &&
        existing.__headerExtra === headerExtra
            ? existing
            : null;

    let card = reused;
    if (card) {
        // The header (and its mode switch) is kept so the pill keeps its
        // transition, but a switch can change the lede copy - e.g. the decay
        // chart's reality/newest-map blurbs - so refresh that text in place
        // when it differs.
        if (lede !== card.__lede) {
            card.__lede = lede;
            if (card.__header.__ledeEl) card.__header.__ledeEl.remove();
            card.__header.__ledeEl = lede ? createChartLede(lede) : null;
            if (card.__header.__ledeEl) card.__header.append(card.__header.__ledeEl);
        }
        // Strip the previous legend + plot, keep the header. The detached
        // slot's width watcher is swept by the next mountResponsiveChart call.
        while (card.lastElementChild && card.lastElementChild !== card.__header) {
            card.lastElementChild.remove();
        }
    } else {
        card = document.createElement("article");
        card.className = `card chart-card${cardClass ? ` ${cardClass}` : ""}`;
        const header = buildHeader(title, subtitle, lede, headerExtra);
        card.__header = header;
        card.__title = title;
        card.__subtitle = subtitle;
        card.__headerExtra = headerExtra;
        card.__lede = lede;
        card.append(header);
        parent.replaceChildren(card);
    }

    if (legend) card.append(legend);

    const slot = document.createElement("div");
    slot.className = "chart-card__plot";
    card.append(slot);

    return mountResponsiveChart(slot, {
        title: null,
        draw: drawPlot,
        layout,
    });
}

function buildHeader(title, subtitle, lede, headerExtra) {
    //Two bands: title row (control floated right), then the lede on its own
    // full-width line below - it runs under the control too, so the explanation
    // fills the width instead of being boxed beside the switch.
    const header = document.createElement("div");
    header.className = "chart-card__header";

    const row = document.createElement("div");
    row.className = "chart-card__header-row";

    const label = document.createElement("span");
    label.className = "card__label uppercase-label";
    label.textContent = (title ?? "").toUpperCase();

    if (subtitle) {
        // Group label and subtitle so they stay together when the header
        // wraps; the subtitle reads as a smaller note.
        const group = document.createElement("div");
        group.className = "chart-card__title";
        const sub = document.createElement("span");
        sub.className = "chart-card__subtitle muted";
        sub.textContent = subtitle;
        group.append(label, sub);
        row.append(group);
    } else {
        row.append(label);
    }

    if (headerExtra) {
        headerExtra.classList.add("chart-card__header-extra");
        row.append(headerExtra);
    }
    header.append(row);

    if (lede) {
        // Track the lede element so a reused card can swap its text when a
        // header control (e.g. the decay reference toggle) changes the active
        // copy without rebuilding the whole header.
        header.__ledeEl = createChartLede(lede);
        header.append(header.__ledeEl);
    }

    return header;
}
