// Build picker dropdown. Options reversed so the newest build
// sits at the top.

import { formatDate } from "../format.js";
import { t } from "../utils/i18n.js";
import { createDropdown } from "./dropdown.js";

export function mount(parent, maps, currentName, onChange) {
    parent.replaceChildren();
    if (!maps.length) return;

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

    parent.append(dropdown);
}
