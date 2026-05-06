import { formatDate, formatNumber, formatPercent } from "../format.js";

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
    const elem = document.createElement("article");
    elem.className = "card diff-selectors";

    const row = document.createElement("div");
    row.className = "diff-selectors__row";

    const fieldA = createField("Map A", maps);
    const fieldB = createField("Map B", maps);
    const vs = document.createElement("span");
    vs.className = "diff-selectors__vs";
    vs.textContent = "vs";

    row.append(fieldA.elem, vs, fieldB.elem);
    elem.append(row);

    const fire = () => onChange(fieldA.select.value, fieldB.select.value);
    fieldA.select.addEventListener("change", fire);
    fieldB.select.addEventListener("change", fire);

    return {
        elem,
        setSelection(a, b) {
            fieldA.select.value = a;
            fieldB.select.value = b;
            fire();
        },
    };
}

function createField(labelText, maps) {
    const elem = document.createElement("label");
    elem.className = "diff-selectors__field";

    const label = document.createElement("span");
    label.className = "diff-selectors__label";
    label.textContent = labelText;

    const select = document.createElement("select");
    select.className = "diff-selectors__select";
    for (const map of maps) {
        const option = document.createElement("option");
        option.value = map.name;
        option.textContent = formatDate(map.released_at);
        select.append(option);
    }

    elem.append(label, select);
    return { elem, select };
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
    card.append(matchBanner(diff), classificationRow(diff), stackedBar(diff));
    parent.replaceChildren(card);
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
    detail.textContent = `match \u2014 ${formatNumber(diff.total_changes)} of ${formatNumber(denom)} entries differ`;

    wrap.append(headline, detail);
    return wrap;
}

function classificationRow(diff) {
    const total = diff.total_changes || 1;
    const cells = [
        { label: "Reassigned", value: diff.reassigned, modifier: "reassigned" },
        { label: "Newly Mapped", value: diff.newly_mapped, modifier: "new" },
        { label: "Unmapped", value: diff.unmapped, modifier: "unmapped" },
    ];

    const row = document.createElement("div");
    row.className = "classification-row";
    for (const cell of cells) {
        const node = document.createElement("div");
        node.className = "classification-cell";

        const value = document.createElement("p");
        value.className = "classification-cell__value";
        value.textContent = formatNumber(cell.value);

        const share = document.createElement("p");
        share.className = `classification-cell__share classification-cell__share--${cell.modifier}`;
        share.textContent = formatPercent(cell.value / total, 1);

        const label = document.createElement("p");
        label.className = "classification-cell__label muted";
        label.textContent = cell.label;

        node.append(value, share, label);
        row.append(node);
    }
    return row;
}

function stackedBar(diff) {
    const total = diff.total_changes || 1;
    const wrap = document.createElement("div");
    wrap.className = "stacked-bar";
    const segments = [
        { value: diff.reassigned, modifier: "reassigned" },
        { value: diff.newly_mapped, modifier: "new" },
        { value: diff.unmapped, modifier: "unmapped" },
    ];
    for (const seg of segments) {
        if (seg.value === 0) continue;
        const fill = document.createElement("div");
        fill.className = `stacked-bar__segment stacked-bar__segment--${seg.modifier}`;
        fill.style.flexGrow = String(seg.value / total);
        fill.textContent = formatPercent(seg.value / total, 1);
        wrap.append(fill);
    }
    return wrap;
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
