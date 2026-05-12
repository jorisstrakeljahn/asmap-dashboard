// Drop-in build picker for any section that wants to scope its
// metrics to a single map. The caller passes the full ``maps``
// list (oldest-first, matching the metrics.json order) plus the
// name of the currently active build, and gets the ``onChange``
// callback fired with the picked map's ``name``.
//
// No visible caption: the page heading / overview lede already
// names the notion; an extra "BUILD" label was redundant noise.
//
// Options are reversed so the newest build sits at the top of the
// list, which is what a reader expects from a build picker.

import { formatDate } from "../format.js";
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
        ariaLabel:
            "ASmap build for Overview metrics (newest builds listed first)",
    });
    dropdown.classList.add("build-selector");

    parent.append(dropdown);
}
