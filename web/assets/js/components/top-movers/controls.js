// Toolbar + footer controls for the Top Movers card. Builders
// returning { elem, setValue } let the orchestrator reset them
// uniformly on Clear.

import { CROSS } from "../../utils/symbols.js";
import { uniqueId } from "../../utils/dom.js";
import { t } from "../../utils/i18n.js";
import { createDropdown } from "../dropdown.js";
import { createInfoTooltip } from "../info-tooltip.js";
import { createModeSwitch } from "../mode-switch.js";
import { PAGE_SIZES } from "./state.js";
import { DIRECTION_FILTER_VALUES } from "./filter.js";

export function cardInfoTooltip() {
    const explainer = createInfoTooltip({
        body: t("topMovers.info"),
        ariaLabel: t("topMovers.infoAria"),
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
    const wrap = document.createElement("div");
    wrap.className = "top-movers__page-size";

    const labelId = uniqueId("top-movers-page-size-label");
    const text = document.createElement("span");
    text.className = "muted";
    text.id = labelId;
    text.textContent = t("topMovers.pageSize.label");

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

    wrap.append(text, dropdown);
    return wrap;
}

// Explicit pageIndex reset avoids a one-frame flash on the
// old page before clampPageIndex() catches up in render().
export function buildFilterInput(state, onChange) {
    const elem = document.createElement("div");
    elem.className = "top-movers__filter-field";

    const input = document.createElement("input");
    input.type = "search";
    input.className = "top-movers__filter-input";
    input.placeholder = t("topMovers.filter.placeholder");
    input.value = state.filterText;
    input.setAttribute("aria-label", t("topMovers.filter.ariaLabel"));
    input.addEventListener("input", () => {
        state.filterText = input.value;
        state.pageIndex = 0;
        onChange();
    });

    elem.append(input);
    return {
        elem,
        setValue(next) {
            input.value = next;
        },
    };
}

// CSS pins a min-width on .top-movers__direction-dropdown to the
// longest label ("Exchanged ↔") so the toolbar doesn't shift
// when a shorter option is picked.
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
        slot.replaceChildren();
        return;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "top-movers__clear";
    button.setAttribute("aria-label", t("topMovers.filter.clearAria"));

    const glyph = document.createElement("span");
    glyph.className = "top-movers__clear-glyph";
    glyph.setAttribute("aria-hidden", "true");
    glyph.textContent = CROSS;

    const text = document.createElement("span");
    text.textContent = t("topMovers.filter.clear");

    button.append(glyph, text);
    button.addEventListener("click", onClear);
    slot.replaceChildren(button);
}
