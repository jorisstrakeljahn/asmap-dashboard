// Map A / Map B selector pair. A is always chronologically
// earlier than B so newly_mapped / unmapped read unambiguously
// as "gained" / "lost" forward in time; the dropdowns enforce
// the ordering by greying out impossible options and bumping
// the counterpart on conflicting picks.

import { ARROW } from "../../utils/symbols.js";
import { uniqueId } from "../../utils/dom.js";
import { formatDate } from "../../format.js";
import { t } from "../../utils/i18n.js";
import { createDropdown } from "../dropdown.js";

export function createSelectors(maps, onChange) {
    const elem = document.createElement("div");
    elem.className = "diff-selectors";

    const row = document.createElement("div");
    row.className = "diff-selectors__row";

    const options = maps.map((map) => ({
        value: map.name,
        label: formatDate(map.released_at),
    }));

    // maps[] is chronological (oldest first), so index ordering
    // doubles as time ordering.
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
        // Belt-and-braces clamp for programmatic setSelection()
        // calls (e.g. permalinks) that bypass the dropdown.
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

    // Arrow not "vs" — newly_mapped / unmapped are asymmetric
    // and depend on which side is the baseline.
    const arrow = document.createElement("span");
    arrow.className = "diff-selectors__arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = ARROW.RIGHT;

    row.append(fieldA.elem, arrow, fieldB.elem);
    elem.append(row);

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
    const elem = document.createElement("div");
    elem.className = "diff-selectors__field";

    const labelId = uniqueId("diff-selector-label");
    const label = document.createElement("span");
    label.className = "diff-selectors__label";
    label.id = labelId;
    label.textContent = labelText;

    const dropdown = createDropdown({
        options,
        value: options[0].value,
        ariaLabelledBy: labelId,
        onChange: onValueChange,
    });

    elem.append(label, dropdown);
    return { elem, dropdown };
}
