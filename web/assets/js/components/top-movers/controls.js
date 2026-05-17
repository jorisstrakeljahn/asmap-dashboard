// Toolbar + footer controls for the Top Movers card.
//
// Filter input, direction dropdown, page-size dropdown, view-mode
// switch and the Clear pill all live here. Each builder returns
// either a plain element or { elem, setValue } so the orchestrator
// can append them uniformly and reset their values on Clear.
//
// The TOP_MOVERS_INFO copy block is co-located here because the
// info tooltip in the card header is rendered alongside the
// view-mode switch on the same row; keeping the text next to the
// builder that places it saves one cross-module hop when copy
// edits are the most likely future change.

import { CROSS } from "../../utils/symbols.js";
import { uniqueId } from "../../utils/dom.js";
import { createDropdown } from "../dropdown.js";
import { createInfoTooltip } from "../info-tooltip.js";
import { createModeSwitch } from "../mode-switch.js";
import { PAGE_SIZES } from "./state.js";
import { DIRECTION_FILTERS } from "./filter.js";

// Single tooltip describing every column the table exposes. One
// bullet per column reads as a glossary so the user does not have
// to scan three separate icons in the header strip.
export const TOP_MOVERS_INFO = [
    "Autonomous systems most affected by the selected diff, ranked by entry-level change count.",
    {
        lead: "Changes.",
        text: "Number of prefix to ASN entries in the binary trie that name this AS on either side of the diff. Each entry is counted once.",
    },
    {
        lead: "Touched.",
        text: "How much of this AS's presence the diff visited, expressed as a multiple of its prefix count. 0.50\u00d7 means roughly half of its prefixes participated; 1.00\u00d7 means the diff touched as many trie positions as the AS holds in either map. Values above 1.00\u00d7 appear when one build aggregates the AS into a single large block while the other splits the same range into many smaller pieces — the diff then visits many trie positions per leaf, so the ratio is not capped to 100 %.",
    },
    {
        lead: "% of all.",
        text: "This AS's share of the total entry-level changes between the two builds.",
    },
    {
        lead: "Direction.",
        text: "↗ gained from the counterpart, ↘ lost to it, ↔ prefixes moved both ways, → unmapped means the prefixes lost their ASN entirely.",
    },
];

export function cardInfoTooltip() {
    const explainer = createInfoTooltip({
        body: TOP_MOVERS_INFO,
        ariaLabel: "About the top movers table",
    });
    explainer.classList.add("top-movers__info");
    return explainer;
}

// Compact / Detailed switch shares the pill-style mode-switch
// component with the drift chart, so the table header speaks the
// same control language as the drift card. Compact hides the
// operator name under each AS number; Detailed shows it.
export function viewModeSwitch(state, onChange, persist) {
    return createModeSwitch({
        options: [
            { value: "compact", label: "Compact" },
            { value: "detailed", label: "Detailed" },
        ],
        value: state.showNames ? "detailed" : "compact",
        onChange: (next) => {
            state.showNames = next === "detailed";
            persist(state.showNames);
            onChange();
        },
        ariaLabel: "Top movers view mode",
    });
}

export function pageSizeControl(state, onChange) {
    const wrap = document.createElement("div");
    wrap.className = "top-movers__page-size";

    const labelId = uniqueId("top-movers-page-size-label");
    const text = document.createElement("span");
    text.className = "muted";
    text.id = labelId;
    text.textContent = "Page size";

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

// Substring filter input. The pageIndex reset lives in render()
// via clampPageIndex(), but an explicit reset here keeps the
// first keystroke from briefly landing on a non-existent page
// before the clamp runs.
export function buildFilterInput(state, onChange) {
    const elem = document.createElement("div");
    elem.className = "top-movers__filter-field";

    const input = document.createElement("input");
    input.type = "search";
    input.className = "top-movers__filter-input";
    input.placeholder = "Filter by AS number or operator";
    input.value = state.filterText;
    input.setAttribute("aria-label", "Filter top movers");
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

// Pin a min-width on the direction dropdown so the trigger stays
// the same size on every option (the longest label
// "Exchanged ↔" sets the floor). Without this, switching to
// "Lost ↘" would shrink the chip and shove the rest of the
// toolbar around.
export function buildDirectionFilter(state, onChange) {
    const dropdown = createDropdown({
        options: DIRECTION_FILTERS.map(({ value, label }) => ({ value, label })),
        value: state.filterDirection,
        ariaLabel: "Filter by direction",
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

// Renders an "✕ Clear" pill into the toolbar's right-hand slot
// whenever a filter narrows the matrix. The element collapses out
// of the layout when no filter is active so the toolbar reads as
// a single field row in the default state.
export function renderClearButton(slot, active, onClear) {
    if (!active) {
        slot.replaceChildren();
        return;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "top-movers__clear";
    button.setAttribute("aria-label", "Clear filter");

    const glyph = document.createElement("span");
    glyph.className = "top-movers__clear-glyph";
    glyph.setAttribute("aria-hidden", "true");
    glyph.textContent = CROSS;

    const text = document.createElement("span");
    text.textContent = "Clear";

    button.append(glyph, text);
    button.addEventListener("click", onClear);
    slot.replaceChildren(button);
}
