// Diff Explorer section: Map A / Map B selectors plus the
// rendered comparison (match-rate banner, three-way classification
// breakdown, stacked bar, and the Top Movers table). Reverse pairs
// are resolved by inverting the stored diff so the user can pick
// any combination without forcing the pipeline to materialise both
// directions.

import { formatDate, formatNumber, formatPercent } from "../format.js";
import { uniqueId } from "../utils/dom.js";
import { createDropdown } from "./dropdown.js";
import { createInfoTooltip } from "./info-tooltip.js";
import * as topMoversTable from "./top-movers-table.js";

// Single source of truth for the three diff classifications.
// Same order, labels and CSS modifiers feed both the headline
// row (classificationRow) and the stacked bar (stackedBar) so
// they can never drift apart.
//
//   field    – key in the diff payload
//   label    – human-readable name
//   modifier – BEM modifier used on .classification-cell__share
//              and .stacked-bar__segment
const DIFF_CATEGORIES = [
    { field: "reassigned", label: "Reassigned", modifier: "reassigned" },
    { field: "newly_mapped", label: "Newly Mapped", modifier: "new" },
    { field: "unmapped", label: "Unmapped", modifier: "unmapped" },
];

// Combined explainer for the three classification buckets,
// rendered as a single card-corner tooltip on .diff-results.
// One labelled paragraph per bucket reads as a glossary while
// keeping the visual surface free of three separate icons.
const DIFF_RESULTS_INFO = [
    "Each entry-level change between Map A and Map B falls into exactly one of three buckets.",
    {
        lead: "Reassigned.",
        text: "A prefix kept its mapping but changed which autonomous system it points to. This is where most ASmap edits land.",
    },
    {
        lead: "Newly Mapped.",
        text: "A prefix had no autonomous system in Map A and now resolves to one in Map B.",
    },
    {
        lead: "Unmapped.",
        text: "A prefix that resolved to an autonomous system in Map A no longer resolves to one in Map B.",
    },
];

const DIRECTION_ARROW = "\u2192";
const EM_DASH = "\u2014";

export function mount(parent, payload) {
    if (!payload.maps.length || !payload.diffs.length) {
        parent.replaceChildren(emptyState());
        return;
    }

    const root = document.createElement("div");
    root.className = "diff-explorer";

    const results = document.createElement("div");
    results.className = "diff-explorer__results";

    const refresh = (fromName, toName) =>
        renderResults(results, payload.diffs, fromName, toName);

    const selectors = createSelectors(payload.maps, refresh);

    root.append(selectors.elem, results);
    parent.replaceChildren(root);

    selectors.setSelection(
        payload.maps.at(-2).name,
        payload.maps.at(-1).name,
    );
}

function createSelectors(maps, onChange) {
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

    const fire = () =>
        onChange(fieldA.dropdown.getValue(), fieldB.dropdown.getValue());

    const onAChange = (newA) => {
        const aIdx = indexOf(newA);
        const bIdx = indexOf(fieldB.dropdown.getValue());
        if (bIdx <= aIdx) {
            // Bump B forward; if A is the newest map, fall back to
            // pinning B to the same map so the UI shows the
            // "pick two different maps" notice instead of silently
            // keeping a backward pair.
            const nextB = aIdx + 1 < maps.length ? maps[aIdx + 1].name : newA;
            fieldB.dropdown.setValue(nextB);
        }
        fire();
    };
    const onBChange = (newB) => {
        const bIdx = indexOf(newB);
        const aIdx = indexOf(fieldA.dropdown.getValue());
        if (aIdx >= bIdx) {
            // Bump A backward; if B is the oldest map, pin A to
            // the same map for the same reason as above.
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
    // "unmapped" became asymmetric counts that flip when the user
    // swaps A and B.
    const arrow = document.createElement("span");
    arrow.className = "diff-selectors__arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = DIRECTION_ARROW;

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

function renderResults(parent, diffs, fromName, toName) {
    if (fromName === toName) {
        parent.replaceChildren(samePairMessage());
        return;
    }
    const diff = resolveDiff(diffs, fromName, toName);
    if (!diff) {
        parent.replaceChildren(unavailableMessage());
        return;
    }
    const card = document.createElement("article");
    card.className = "card diff-results";
    const explainer = createInfoTooltip({
        body: DIFF_RESULTS_INFO,
        ariaLabel: "About the diff classification",
    });
    explainer.classList.add("info-tooltip--card-corner");
    card.append(
        explainer,
        matchBanner(diff),
        classificationRow(diff),
        stackedBar(diff),
    );

    const topMoversSlot = document.createElement("div");
    topMoversTable.mount(topMoversSlot, diff);

    parent.replaceChildren(card, topMoversSlot);
}

// metrics.json stores every diff once with from < to (chronological).
// When the user picks Map A newer than Map B, the stored entry is in
// the opposite direction, so we look it up swapped and invert the
// asymmetric counts: newly_mapped <-> unmapped (a prefix that gained
// an ASN going forward in time has lost it going backward, and vice
// versa). Reassigned and total_changes are symmetric and pass through.
function resolveDiff(diffs, fromName, toName) {
    const direct = diffs.find(
        (d) => d.from === fromName && d.to === toName,
    );
    if (direct) return direct;
    const reversed = diffs.find(
        (d) => d.from === toName && d.to === fromName,
    );
    return reversed ? invertDiff(reversed, fromName, toName) : null;
}

function invertDiff(diff, fromName, toName) {
    return {
        ...diff,
        from: fromName,
        to: toName,
        entries_a: diff.entries_b,
        entries_b: diff.entries_a,
        newly_mapped: diff.unmapped,
        unmapped: diff.newly_mapped,
        top_movers: (diff.top_movers || []).map(invertTopMover),
    };
}

function invertTopMover(row) {
    if (row.gained === undefined && row.lost === undefined) return row;
    return {
        ...row,
        gained: row.lost ?? 0,
        lost: row.gained ?? 0,
    };
}

function matchBanner(diff) {
    const denom = Math.max(diff.entries_a, diff.entries_b);
    const matchRate = denom ? 1 - diff.total_changes / denom : 1;
    const wrap = document.createElement("div");
    wrap.className = "match-banner";

    const headline = document.createElement("span");
    headline.className = "match-banner__headline";
    headline.textContent = formatPercent(matchRate, 1);

    const detail = document.createElement("span");
    detail.className = "match-banner__detail";
    detail.textContent =
        `match ${EM_DASH} ${formatNumber(diff.total_changes)} of ` +
        `${formatNumber(denom)} entries differ`;

    wrap.append(headline, detail);
    return wrap;
}

function classificationRow(diff) {
    const total = diff.total_changes || 1;
    const row = document.createElement("div");
    row.className = "classification-row";
    for (const category of DIFF_CATEGORIES) {
        row.append(classificationCell(category, diff[category.field], total));
    }
    return row;
}

function classificationCell({ label, modifier }, value, total) {
    const node = document.createElement("div");
    node.className = "classification-cell";

    const valueEl = document.createElement("p");
    valueEl.className = "classification-cell__value";
    valueEl.textContent = formatNumber(value);

    const shareEl = document.createElement("p");
    shareEl.className =
        `classification-cell__share classification-cell__share--${modifier}`;
    shareEl.textContent = formatPercent(value / total, 1);

    const labelEl = document.createElement("p");
    labelEl.className = "classification-cell__label muted";
    labelEl.textContent = label;

    node.append(valueEl, shareEl, labelEl);
    return node;
}

function stackedBar(diff) {
    const total = diff.total_changes || 1;
    const wrap = document.createElement("div");
    wrap.className = "stacked-bar";
    for (const { field, modifier } of DIFF_CATEGORIES) {
        const value = diff[field];
        if (value === 0) continue;
        wrap.append(stackedSegment(value / total, modifier));
    }
    return wrap;
}

function stackedSegment(share, modifier) {
    const fill = document.createElement("div");
    fill.className = `stacked-bar__segment stacked-bar__segment--${modifier}`;
    fill.style.flexGrow = String(share);
    fill.textContent = formatPercent(share, 1);
    return fill;
}

function samePairMessage() {
    const node = document.createElement("p");
    node.className = "diff-explorer__notice muted";
    node.textContent = "Pick two different maps to see what changed.";
    return node;
}

function unavailableMessage() {
    const node = document.createElement("p");
    node.className = "diff-explorer__notice muted";
    node.textContent =
        "No precomputed diff for this pair.";
    return node;
}

function emptyState() {
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = "metrics.json contains no diffs yet.";
    return note;
}
