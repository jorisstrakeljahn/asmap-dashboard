// Toolbar + footer controls for the Top Movers card. Builders returning
// { elem, setValue } let the orchestrator reset them uniformly on Clear.

import { html, nothing, render } from "../../vendor/lit-html.js";
import { CROSS } from "../../utils/symbols.js";
import { renderToElement, uniqueId } from "../../utils/dom.js";
import { t } from "../../utils/i18n.js";
import { createDropdown } from "../dropdown.js";
import { createInfoTooltip } from "../info-tooltip.js";
import { createModeSwitch } from "../mode-switch.js";
import { PAGE_SIZES } from "./state.js";
import { DIRECTION_FILTER_VALUES } from "./filter.js";

export function cardInfoTooltip(sheetHeader) {
    const explainer = createInfoTooltip({
        body: t("topMovers.info"),
        ariaLabel: t("topMovers.infoAria"),
        sheetHeader,
    });
    explainer.classList.add("top-movers__info");
    return explainer;
}

// Compact hides operator names; Detailed shows them.
export function viewModeSwitch(state, onChange, persist) {
    return createModeSwitch({
        options: [
            { value: "compact", label: t("topMovers.viewMode.compact") },
            { value: "detailed", label: t("topMovers.viewMode.detailed") },
        ],
        value: state.showNames ? "detailed" : "compact",
        onChange: (next) => {
            state.showNames = next === "detailed";
            persist(state.showNames);
            onChange();
        },
        ariaLabel: t("topMovers.viewMode.ariaLabel"),
    });
}

export function pageSizeControl(state, onChange) {
    const labelId = uniqueId("top-movers-page-size-label");
    const dropdown = createDropdown({
        options: PAGE_SIZES.map((size) => ({
            value: String(size),
            label: String(size),
        })),
        value: String(state.pageSize),
        ariaLabelledBy: labelId,
        size: "small",
        onChange: (value) => {
            state.pageSize = Number(value);
            state.pageIndex = 0;
            onChange();
        },
    });

    return renderToElement(html`
        <div class="top-movers__page-size">
            <span class="muted" id=${labelId}>${t("topMovers.pageSize.label")}</span>
            ${dropdown}
        </div>
    `);
}

// Explicit pageIndex reset avoids a one-frame flash on the old page before
// clampPageIndex() catches up in render().
export function buildFilterInput(state, onChange) {
    const elem = renderToElement(html`
        <div class="top-movers__filter-field">
            <input
                type="search"
                name="top-movers-filter"
                autocomplete="off"
                class="top-movers__filter-input"
                placeholder=${t("topMovers.filter.placeholder")}
                .value=${state.filterText}
                aria-label=${t("topMovers.filter.ariaLabel")}
                @input=${(event) => {
                    state.filterText = event.target.value;
                    state.pageIndex = 0;
                    onChange();
                }}
            />
        </div>
    `);
    const input = elem.querySelector(".top-movers__filter-input");
    return {
        elem,
        setValue(next) {
            input.value = next;
        },
    };
}

// CSS pins a min-width on .top-movers__direction-dropdown to the longest label
// ("Exchanged ↔") so the toolbar doesn't shift when a shorter option is picked.
export function buildDirectionFilter(state, onChange) {
    const dropdown = createDropdown({
        options: DIRECTION_FILTER_VALUES.map((value) => ({
            value,
            label: t(`topMovers.direction.${value}`),
        })),
        value: state.filterDirection,
        ariaLabel: t("topMovers.filter.directionAria"),
        size: "small",
        onChange: (next) => {
            state.filterDirection = next;
            state.pageIndex = 0;
            onChange();
        },
    });
    dropdown.classList.add("top-movers__direction-dropdown");
    return {
        elem: dropdown,
        setValue(next) {
            dropdown.setValue(next);
        },
    };
}

// "✕ Clear" pill, only rendered while a filter is active.
export function renderClearButton(slot, active, onClear) {
    if (!active) {
        render(nothing, slot);
        return;
    }
    render(
        html`<button
            type="button"
            class="top-movers__clear"
            aria-label=${t("topMovers.filter.clearAria")}
            @click=${onClear}
        ><span class="top-movers__clear-glyph" aria-hidden="true">${CROSS}</span
            ><span>${t("topMovers.filter.clear")}</span></button>`,
        slot,
    );
}
