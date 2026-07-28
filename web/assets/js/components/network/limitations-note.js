// Network-tab Limitations section: same section chrome as Network / Trends
// (sibling <section>, shared border + spacing). Title uses section__title;
// the caveat is a full-width section__lede with methodology and BNOC
// links in the prose. No live host count — that number moves daily.

import { html, render } from "../../vendor/lit-html.js";
import { t } from "../../utils/i18n.js";

const METHODOLOGY_URL =
    "https://github.com/jorisstrakeljahn/asmap-dashboard/blob/main/docs/network-exclusions.md";
const BNOC_URL =
    "https://bnoc.xyz/t/small-getaddr-responses-from-897-nodes-satoshi-27-0-0-on-as63949/121/11";

export function mountLimitationsNote() {
    const slot = document.querySelector("[data-network-limitations]");
    if (!slot) return;

    render(
        html`
            <header class="section__header">
                <div class="section__heading">
                    <h2 id="network-limitations-title" class="section__title">
                        ${t("network.limitations.title")}
                    </h2>
                    <p class="section__lede">
                        ${t("network.limitations.ledeBefore")}
                        <a
                            href=${METHODOLOGY_URL}
                            rel="noopener noreferrer"
                            target="_blank"
                            >${t("network.limitations.methodology")}</a
                        >${t("network.limitations.ledeMid")}<a
                            href=${BNOC_URL}
                            rel="noopener noreferrer"
                            target="_blank"
                            >${t("network.limitations.bnoc")}</a
                        >${t("network.limitations.ledeAfter")}
                    </p>
                </div>
            </header>
        `,
        slot,
    );
}
