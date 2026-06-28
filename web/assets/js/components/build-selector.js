// Build picker dropdown. Options reversed so the newest build
// sits at the top.

import { nothing } from "../vendor/lit-html.js";
import { formatDate } from "../format.js";
import { renderInto } from "../utils/dom.js";
import { t } from "../utils/i18n.js";
import { createDropdown } from "./dropdown.js";

export function mount(parent, maps, currentName, onChange) {
    if (!maps.length) {
        renderInto(nothing, parent);
        return;
    }

    const options = [...maps].reverse().map((map) => ({
        value: map.name,
        label: formatDate(map.released_at),
    }));

    const dropdown = createDropdown({
        options,
        value: currentName,
        onChange,
        ariaLabel: t("overview.buildSelector.ariaLabel"),
    });
    dropdown.classList.add("build-selector");

    renderInto(dropdown, parent);
}
