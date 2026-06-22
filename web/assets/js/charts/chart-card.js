// Shared chrome for header-bearing chart cards: the card shell, an
// optional header (title + lede + an optional caller control), an
// optional legend, and a plot slot that delegates the responsive
// SVG to mountResponsiveChart. Shared by the Network series charts,
// the top-operator breakdown, and the Maps drift chart.
//
// Reuse: when the same chart re-renders into the same slot, the
// existing card is kept and only its legend + plot are swapped, so a
// header control (a mode switch) is never re-parented — that would
// reset its in-flight pill transition. The identity check on
// ``headerExtra`` scopes reuse to the same chart + control (charts
// without one compare null === null and reuse too).

import { mountResponsiveChart } from "./chart-base.js";
import { createChartLede } from "../components/chart-lede.js";

// Mount (or re-render into) a header-bearing chart card under
// ``parent`` and return the mountResponsiveChart handle so a clickable
// legend can call ``ctrl.rerender()`` after a toggle.
//
//   title:       card label text (rendered upper-cased)
//   subtitle:    secondary label beside the title (e.g. active unit),
//                optional; changing it rebuilds the header
//   lede:        short summary shown below the header, always
//                visible, optional
//   headerExtra: Element placed beside the headline (e.g. a mode
//                switch), optional; its identity gates card reuse
//   legend:      pre-built legend Element placed above the plot, optional
//   drawPlot:    ({ width, height, layout }) -> Element, the plot body
//   cardClass:   extra class(es) for the outer <article>, optional
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

    // Reuse the card in this slot only when its header content is
    // unchanged: same title, subtitle, and the very same headerExtra
    // element. This keeps a header control from being re-parented
    // (which would reset its pill transition). A changed subtitle must
    // rebuild so the header reflects it.
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
        // Strip the previous legend + plot, keep the header. The
        // detached slot's width watcher is swept by the next
        // mountResponsiveChart call below.
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
        card.append(header);
        parent.replaceChildren(card);
    }

    if (legend) card.append(legend);

    const slot = document.createElement("div");
    slot.className = "chart-card__plot";
    card.append(slot);

    const handle = mountResponsiveChart(slot, {
        title: null,
        draw: drawPlot,
        layout,
    });

    return handle;
}

function buildHeader(title, subtitle, lede, headerExtra) {
    // The header stacks two bands: a top row holding the title (and any
    // control floated right), then the lede on its own line spanning the
    // full card width — it runs under the control too, so the
    // explanation fills the width instead of being boxed into a narrow
    // left column beside the switch.
    const header = document.createElement("div");
    header.className = "chart-card__header";

    const row = document.createElement("div");
    row.className = "chart-card__header-row";

    const label = document.createElement("span");
    label.className = "card__label uppercase-label";
    label.textContent = (title ?? "").toUpperCase();

    if (subtitle) {
        // Group label and subtitle so they stay together when the
        // header wraps; the subtitle reads as a smaller note.
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

    if (lede) header.append(createChartLede(lede));

    return header;
}
