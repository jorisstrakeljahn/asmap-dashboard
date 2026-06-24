// Always-on chart lede: a short summary below the card title so a
// first-time visitor learns what the chart shows without clicking. The
// deep methodology lives on asmap.org, so this is the on-page explanation.

export function createChartLede(text) {
    const p = document.createElement("p");
    p.className = "chart-card__lede";
    p.textContent = text;
    return p;
}
