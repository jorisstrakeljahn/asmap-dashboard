// Diff Explorer section: Map A / Map B selectors plus the
// rendered comparison (match-rate banner, three-way classification
// breakdown, stacked bar, and the Top Movers table). Map A is
// always chronologically earlier than Map B; the selectors enforce
// the ordering by bumping the counterpart whenever the user picks
// a same-or-later A or a same-or-earlier B. Keeping the time
// direction fixed lets newly_mapped / unmapped read unambiguously
// (always "gained" / "lost" going forward in time) and removes the
// need to materialise reverse-direction diffs in the payload.

import { formatDate, formatNumber, formatPercent } from "../format.js";
import { mutedNote, uniqueId } from "../utils/dom.js";
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
//   modifier – BEM modifier used on .classification-cell__label
//              (label colour) and .stacked-bar__segment
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
        text: "A prefix was mapped in both Map A and Map B, but now resolves to a different autonomous system. This is where most ASmap edits land.",
    },
    {
        lead: "Newly Mapped.",
        text: "A prefix had no autonomous system in Map A and now resolves to one in Map B.",
    },
    {
        lead: "Unmapped.",
        text: "A prefix that resolved to an autonomous system in Map A no longer resolves to one in Map B.",
    },
    "The caption under each bucket splits the count by address family. Bitcoin Core peer diversity treats IPv4 and IPv6 as separate dimensions, so a diff that moves 10 000 IPv4 prefixes has a different operational signature than one that moves 10 000 IPv6 prefixes.",
    {
        lead: "AS roster delta.",
        text: "The footer line under the stacked bar tracks how many distinct autonomous systems each build maps, plus how many appeared (present in Map B but not in Map A) and disappeared (present in A but not in B). Appeared \u2212 disappeared equals the \"+N vs previous\" delta on the Unique ASes overview card for the same pair \u2014 the two views agree on the same arithmetic.",
    },
    "Computed from the unfilled (source data) variant of each build, so each change is a real BGP / RPKI / IRR shift rather than a fill-heuristic artefact.",
];

const DIRECTION_ARROW = "\u2192";
const EM_DASH = "\u2014";
const MINUS = "\u2212";

// Human-readable label for the asmap variant field stored on each
// diff. Today the pipeline only emits unfilled-vs-unfilled pairs,
// but the variant field on the payload future-proofs the headline
// so a filled-vs-filled diff would not silently masquerade as a
// raw source-data comparison.
const VARIANT_LABELS = {
    unfilled: "Source data (unfilled)",
    filled: "Embedded (filled)",
};

export function mount(parent, payload) {
    if (!payload.maps.length || !payload.diffs.length) {
        parent.replaceChildren(mutedNote("metrics.json contains no diffs yet."));
        return;
    }

    const root = document.createElement("div");
    root.className = "diff-explorer";

    const results = document.createElement("div");
    results.className = "diff-explorer__results";

    const nameToReleaseDate = new Map(
        payload.maps.map((m) => [m.name, m.released_at]),
    );

    const refresh = (fromName, toName) => {
        writeDiffParamsToHash(
            nameToReleaseDate.get(fromName),
            nameToReleaseDate.get(toName),
        );
        renderResults(results, payload.diffs, fromName, toName);
    };

    const selectors = createSelectors(payload.maps, refresh);

    root.append(selectors.elem, results);
    parent.replaceChildren(root);

    const initial = resolveInitialSelection(payload.maps);
    selectors.setSelection(initial.a, initial.b);
}

// URL hash convention for sharable diff links:
//
//   #diff?a=YYYY-MM-DD&b=YYYY-MM-DD
//
// Dates are taken from each map's released_at field rather than
// the internal name (e.g. "2026/1770307200") so the URL stays
// human-readable when pasted into chat or a PR comment. The tab
// router in tabs.js already tolerates the "?<query>" suffix on
// any tab token.

const HASH_TAB = "#diff";

function parseDiffHashParams() {
    const raw = window.location.hash;
    const qStart = raw.indexOf("?");
    if (qStart < 0) return {};
    const params = new URLSearchParams(raw.slice(qStart + 1));
    return { a: params.get("a"), b: params.get("b") };
}

// Update the hash without triggering a hashchange listener
// somewhere upstream. replaceState collapses the URL bar update
// into a single history entry per diff selection so the back
// button still steps through user-visible tab changes, not every
// micro-edit to the dropdown pair.
function writeDiffParamsToHash(aDate, bDate) {
    const params = new URLSearchParams();
    if (aDate) params.set("a", aDate);
    if (bDate) params.set("b", bDate);
    const query = params.toString();
    const next = query ? `${HASH_TAB}?${query}` : HASH_TAB;
    if (window.location.hash === next) return;
    history.replaceState(null, "", next);
}

// Pick the initial Map A / Map B pair on mount. If the URL hash
// names a valid, in-order pair we honour it; otherwise we fall
// back to the two most recent builds, which is the most common
// "show me the latest diff" landing experience.
function resolveInitialSelection(maps) {
    const fallback = {
        a: maps.at(-2).name,
        b: maps.at(-1).name,
    };
    const { a: requestedA, b: requestedB } = parseDiffHashParams();
    if (!requestedA || !requestedB) return fallback;
    const aIdx = maps.findIndex((m) => m.released_at === requestedA);
    const bIdx = maps.findIndex((m) => m.released_at === requestedB);
    if (aIdx < 0 || bIdx < 0 || aIdx >= bIdx) return fallback;
    return { a: maps[aIdx].name, b: maps[bIdx].name };
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
    // AS roster delta sits one line below the stacked bar when the
    // payload carries the totals. Older payloads (regenerated
    // before the as_total_* fields landed) skip the row instead of
    // showing zeroes that would silently misrepresent the data.
    const roster = rosterDeltaRow(diff);
    if (roster) card.append(roster);

    const topMoversSlot = document.createElement("div");
    topMoversTable.mount(topMoversSlot, diff);

    parent.replaceChildren(card, topMoversSlot);
}

// metrics.json stores every diff once with from < to. The
// selectors guarantee the same ordering on every render, so a
// direct (fromName, toName) hit is the only lookup we ever need.
// If the lookup ever misses, the pair is genuinely missing from
// the payload (one of the builds lacks an unfilled variant), and
// the caller falls back to unavailableMessage().
function resolveDiff(diffs, fromName, toName) {
    return (
        diffs.find((d) => d.from === fromName && d.to === toName) || null
    );
}

function matchBanner(diff) {
    const denom = Math.max(diff.entries_a, diff.entries_b);
    const matchRate = denom ? 1 - diff.total_changes / denom : 1;
    const wrap = document.createElement("div");
    wrap.className = "match-banner";

    // Headline + count caption share one baseline so the eye reads
    // "95.0% match — 22,614 of 455,725 entries differ" as a single
    // sentence even when the viewport is narrow enough to wrap.
    const headRow = document.createElement("div");
    headRow.className = "match-banner__row";

    const headline = document.createElement("span");
    headline.className = "match-banner__headline";
    headline.textContent = formatPercent(matchRate, 1);

    const detail = document.createElement("span");
    detail.className = "match-banner__detail";
    detail.textContent =
        `match ${EM_DASH} ${formatNumber(diff.total_changes)} of ` +
        `${formatNumber(denom)} entries differ`;

    headRow.append(headline, detail);

    // Variant caption answers "what kind of comparison is this?"
    // without forcing the reader to open the explainer tooltip.
    // The dates live in the Map A / Map B selectors directly
    // above the banner, so they would only echo here. The
    // variant field is read straight from the diff payload so a
    // future filled-vs-filled diff would not be silently
    // mislabelled as source data.
    const variantLabel =
        VARIANT_LABELS[diff.variant] || diff.variant || "Unknown variant";
    const caption = document.createElement("p");
    caption.className = "match-banner__variant";
    caption.textContent = variantLabel;

    wrap.append(headRow, caption);
    return wrap;
}

function classificationRow(diff) {
    const row = document.createElement("div");
    row.className = "classification-row";
    for (const category of DIFF_CATEGORIES) {
        row.append(classificationCell(category, diff));
    }
    return row;
}

function classificationCell(category, diff) {
    const { field, label, modifier } = category;
    const value = diff[field];
    const node = document.createElement("div");
    node.className = "classification-cell";

    const valueEl = document.createElement("p");
    valueEl.className = "classification-cell__value";
    valueEl.textContent = formatNumber(value);

    // The label colour matches the bucket's segment in the stacked
    // bar directly below. The redundant percentage row that used to
    // sit between the value and the label was dropped because the
    // bar already encodes those proportions visually.
    const labelEl = document.createElement("p");
    labelEl.className =
        `classification-cell__label classification-cell__label--${modifier}`;
    labelEl.textContent = label;

    node.append(valueEl, labelEl);

    // Address-family caption: surfaces whether this bucket is mostly
    // IPv4 or IPv6 churn. Bitcoin Core peer selection treats the two
    // families as separate diversity dimensions, so a reviewer
    // looking at a fat "reassigned" number wants to know which side
    // moved. Suppressed on zero-value buckets (no signal to convey)
    // and on older payloads without the split (graceful fallback).
    const v4 = diff[`${field}_ipv4`];
    const v6 = diff[`${field}_ipv6`];
    if (value > 0 && v4 !== undefined && v6 !== undefined) {
        const familyEl = document.createElement("p");
        familyEl.className = "classification-cell__family";
        familyEl.textContent =
            `${formatNumber(v4)} IPv4 + ${formatNumber(v6)} IPv6`;
        node.append(familyEl);
    }

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

// AS roster delta line. Sits below the stacked bar to answer the
// "how many distinct ASes are we talking about?" question that the
// three entry-level buckets cannot speak to. Returns null when the
// payload lacks the as_total_* fields (older metrics.json) so the
// card never falls back to "0 \u2192 0 ASes", which would look
// like a real measurement instead of missing data.
//
// Wording note: "appeared" / "disappeared" are AS-roster terms,
// deliberately different from the bucket names "newly mapped" /
// "unmapped" which apply to prefix entries. A prefix that is newly
// mapped to an existing AS does not change the roster.
function rosterDeltaRow(diff) {
    if (diff.as_total_a === undefined || diff.as_total_b === undefined) {
        return null;
    }
    const a = formatNumber(diff.as_total_a);
    const b = formatNumber(diff.as_total_b);
    const appeared = formatNumber(diff.as_appeared ?? 0);
    const disappeared = formatNumber(diff.as_disappeared ?? 0);
    const p = document.createElement("p");
    p.className = "as-roster-delta";
    // Parenthesised delta keeps the headline pair (A -> B count)
    // visually dominant while the breakdown stays one glance away.
    // Comma instead of a bullet because the two halves are paired
    // counts of the same delta, not a list of independent facts.
    p.textContent =
        `ASes: ${a} ${DIRECTION_ARROW} ${b} ` +
        `(+${appeared} appeared, ${MINUS}${disappeared} disappeared)`;
    return p;
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
    // The most common cause is one side of the pair not having
    // published an unfilled variant. Diffs are computed only between
    // builds that both ship unfilled (see metrics.py), so an
    // unfilled-only build silently drops out of the diff timeline.
    // Stating that explicitly avoids the "is this a bug?" question.
    node.textContent =
        "No precomputed diff for this pair. One of the two builds is missing its unfilled (source data) variant.";
    return node;
}

