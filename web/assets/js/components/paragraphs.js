// Shared paragraph renderer for explanatory bodies. ``input`` is a
// string or an array of paragraphs, each a string or { lead, text }
// where ``lead`` renders bold so multi-bucket explainers read as a
// glossary. Used by both the info tooltip and the always-on chart
// "About" disclosure so the two render identical markup from the same
// i18n payload.

export function renderParagraphs(container, input) {
    container.replaceChildren();
    if (!input) return;
    const paragraphs = Array.isArray(input) ? input : [input];
    for (const paragraph of paragraphs) {
        const p = document.createElement("p");
        p.className = "rich-paragraph";
        if (typeof paragraph === "string") {
            p.textContent = paragraph;
        } else if (paragraph && typeof paragraph === "object") {
            const { lead, text } = paragraph;
            if (lead) {
                const strong = document.createElement("strong");
                strong.className = "rich-paragraph__lead";
                strong.textContent = lead;
                p.append(strong, " ");
            }
            if (text) p.append(text);
        }
        container.append(p);
    }
}
