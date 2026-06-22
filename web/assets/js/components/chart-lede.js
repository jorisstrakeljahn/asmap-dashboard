// Always-on chart lede: a short summary that sits below the card title
// and is always visible, so a first-time visitor learns what the chart
// shows without any clicking. The deep methodology lives on asmap.org,
// not behind a per-chart toggle, so the lede is the on-page explanation.

export function createChartLede(text) {
    const p = document.createElement("p");
    p.className = "chart-card__lede";
    p.textContent = text;
    return p;
}
