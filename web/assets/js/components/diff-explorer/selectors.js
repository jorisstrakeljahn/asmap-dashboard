// Map A / Map B selector pair with the strict-ordering guard.
//
// Map A is always chronologically earlier than Map B; the
// selectors enforce the ordering by greying out impossible
// options in each dropdown and bumping the counterpart whenever
// the user picks a same-or-later A or a same-or-earlier B.
// Keeping the time direction fixed lets newly_mapped / unmapped
// read unambiguously (always "gained" / "lost" going forward in
// time) and removes the need to materialise reverse-direction
// diffs in the payload.

import { ARROW } from "../../utils/symbols.js";
import { uniqueId } from "../../utils/dom.js";
import { formatDate } from "../../format.js";
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

    // ``maps`` is in chronological order (oldest first), so the
    // selector stays valid by index and we can clamp without
    // re-sorting per change. Map B must be strictly newer than
    // Map A; whoever the user just edited is the side we keep,
    // and the counterpart bumps forward / backward to satisfy
    // the constraint.
    const indexOf = (name) => maps.findIndex((m) => m.name === name);

    // Recompute which options are disabled in each dropdown each
    // time either side moves. Map A can only land on builds
    // strictly older than Map B, and Map B only on builds
    // strictly newer than Map A; greying out the impossible rows
    // is more readable than silently bumping the counterpart and
    // showing a "pick two different maps" notice after the fact.
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
        // The Map A dropdown now greys out every option at or
        // after Map B, so a backwards-or-equal pair is no longer
        // reachable through the UI. The clamp below stays as a
        // belt-and-braces guard for programmatic setSelection()
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

    const fieldA = createField("Map A", options, onAChange);
    const fieldB = createField("Map B", options, onBChange);

    // The arrow signals reading direction (A -> B). The previous
    // "vs" looked symmetric and hid which side the diff was
    // computed from, which mattered once "newly mapped" and
    // "unmapped" became asymmetric counts that flip when the
    // user swaps A and B.
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
