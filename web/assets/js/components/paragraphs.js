// Shared paragraph renderer for explanatory bodies. ``input`` is a string
// or an array of paragraphs, each a string or { lead, text } where
// ``lead`` renders bold so multi-bucket explainers read as a glossary.
// Shared by the popover and the mobile sheet so both render identical
// markup from the same i18n payload.

import { html, nothing, render } from "../vendor/lit-html.js";

export function renderParagraphs(container, input) {
    const paragraphs = input ? (Array.isArray(input) ? input : [input]) : [];
    render(html`${paragraphs.map(paragraph)}`, container);
}

function paragraph(entry) {
    if (typeof entry === "string") {
        return html`<p class="rich-paragraph">${entry}</p>`;
    }
    const { lead, text } = entry ?? {};
    return html`<p class="rich-paragraph">${lead
        ? html`<strong class="rich-paragraph__lead">${lead}</strong> `
        : nothing}${text ?? nothing}</p>`;
}
