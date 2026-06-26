// Master IPv4 / IPv6 family toggle for the Diff Explorer: single source of
// truth for which family every surface renders. Persisted in localStorage;
// readSetting()'s whitelist guard drops any stale value from an old build.

import { FAMILY_IPV4, FAMILY_IPV6 } from "../../format.js";
import { t } from "../../utils/i18n.js";
import { readSetting, writeSetting } from "../../utils/storage.js";
import { createModeSwitch } from "../mode-switch.js";

const FAMILY_KEY = "asmap.diff.family";
export const FAMILIES = [FAMILY_IPV4, FAMILY_IPV6];
export const DEFAULT_FAMILY = FAMILY_IPV4;

export function loadFamily() {
    return readSetting(FAMILY_KEY, FAMILIES, DEFAULT_FAMILY);
}

export function saveFamily(family) {
    writeSetting(FAMILY_KEY, family);
}

export function createFamilyToggle(value, onChange) {
    return createModeSwitch({
        options: FAMILIES.map((family) => ({
            value: family,
            label: t(`diff.family.${family}.label`),
        })),
        value,
        onChange,
        ariaLabel: t("diff.family.ariaLabel"),
    });
}
