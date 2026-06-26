// Map A / Map B selector pair. A is always chronologically earlier than B so
// newly_mapped / unmapped read as "gained" / "lost" forward in time; the
// dropdowns enforce this by greying out impossible options and bumping the
// counterpart on conflicts.

import { html } from "../../vendor/lit-html.js";
import { ARROW } from "../../utils/symbols.js";
import { renderToElement, uniqueId } from "../../utils/dom.js";
import { formatDate } from "../../format.js";
import { t } from "../../utils/i18n.js";
import { createDropdown } from "../dropdown.js";

export function createSelectors(maps, onChange) {
    const options = maps.map((map) => ({
        value: map.name,
        label: formatDate(map.released_at),
    }));

    // maps[] is chronological (oldest first), so index ordering doubles as time
    // ordering.
    const indexOf = (name) => maps.findIndex((m) => m.name === name);

    const refreshDisabled = () => {
        const aIdx = indexOf(fieldA.dropdown.getValue());
        const bIdx = indexOf(fieldB.dropdown.getValue());
        const disabledForA = [];
        const disabledForB = [];
        for (let i = 0; i < maps.length; i++) {
            if (i >= bIdx) disabledForA.push(maps[i].name);
            if (i <= aIdx) disabledForB.push(maps[i].name);
        }
        fieldA.dropdown.setDisabledValues(disabledForA);
        fieldB.dropdown.setDisabledValues(disabledForB);
    };

    const fire = () => {
        refreshDisabled();
        onChange(fieldA.dropdown.getValue(), fieldB.dropdown.getValue());
    };

    const onAChange = (newA) => {
        // Belt-and-braces clamp for programmatic setSelection() calls (e.g.
        // permalinks) that bypass the dropdown.
        const aIdx = indexOf(newA);
        const bIdx = indexOf(fieldB.dropdown.getValue());
        if (bIdx <= aIdx) {
            const nextB = aIdx + 1 < maps.length ? maps[aIdx + 1].name : newA;
            fieldB.dropdown.setValue(nextB);
        }
        fire();
    };
    const onBChange = (newB) => {
        const bIdx = indexOf(newB);
        const aIdx = indexOf(fieldA.dropdown.getValue());
        if (aIdx >= bIdx) {
            const nextA = bIdx - 1 >= 0 ? maps[bIdx - 1].name : newB;
            fieldA.dropdown.setValue(nextA);
        }
        fire();
    };

    const fieldA = createField(t("diff.selectors.mapA"), options, onAChange);
    const fieldB = createField(t("diff.selectors.mapB"), options, onBChange);

    // Arrow not "vs" - newly_mapped / unmapped are asymmetric and depend on
    // which side is the baseline.
    const elem = renderToElement(html`
        <div class="diff-selectors">
            <div class="diff-selectors__row">
                ${fieldA.elem}
                <span class="diff-selectors__arrow" aria-hidden="true"
                    >${ARROW.RIGHT}</span
                >
                ${fieldB.elem}
            </div>
        </div>
    `);

    return {
        elem,
        setSelection(a, b) {
            fieldA.dropdown.setValue(a);
            fieldB.dropdown.setValue(b);
            fire();
        },
    };
}

function createField(labelText, options, onValueChange) {
    const labelId = uniqueId("diff-selector-label");
    const dropdown = createDropdown({
        options,
        value: options[0].value,
        ariaLabelledBy: labelId,
        onChange: onValueChange,
    });

    const elem = renderToElement(html`
        <div class="diff-selectors__field">
            <span class="diff-selectors__label" id=${labelId}>${labelText}</span>
            ${dropdown}
        </div>
    `);
    return { elem, dropdown };
}
