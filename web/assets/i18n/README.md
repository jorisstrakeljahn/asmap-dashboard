# Dashboard copy

Every user-facing string lives in this folder as plain JSON. Edit a
value, save, reload — no JavaScript involved.

`en.json` is the only locale today. Future languages (`de.json`,
`es.json`, …) drop in next to it.

## Quick start: editing a string

Find the key, change the value, save. That is the whole loop.

Say the **Drift vs previous** card on the Maps tab says

> A 5 % drift means roughly 1 in 20 lookups would now resolve to a
> different autonomous system.

and you want to reword it. Open `en.json`, search for "1 in 20", and
edit the matching line in place:

```json
"drift": {
    "info": [
        "Share of mapping entries that differ between this build and the most recent diffable predecessor.",
        "Computed from unfilled-vs-unfilled diffs to isolate real source-data drift from fill-heuristic shifts.",
        "A 5 % drift means roughly 1 in 20 lookups would now resolve to a different autonomous system."
    ]
}
```

Reload the dashboard. The new copy is live. No build step, no JS to
recompile.

> **Safety net.** A typo in a key (e.g. the JS code asks for
> `topMovers.colums.changes` but the JSON only has `topMovers.columns.changes`)
> never crashes the dashboard. The renderer prints the missing key
> verbatim as a placeholder and logs a `i18n: missing key "<…>"`
> warning to the browser console, so the typo is obvious the moment
> you reload.

## File anatomy

```json
{
    "_meta": {
        "language": "en",
        "name": "English",
        "version": "1"
    },
    "header": { … },
    "overview": { … },
    "history": { … },
    "diff": { … },
    "topMovers": { … },
    "common": { … }
}
```

- **`_meta`** carries the locale tag and a version marker. Leave them
  alone unless you are forking the file for a new language.
- The other top-level keys are **namespaces**. They mirror the surfaces
  in the dashboard:

| Namespace     | What it covers                                                |
| ------------- | ------------------------------------------------------------- |
| `header`      | Logo, top-bar navigation (Maps / Diff Explorer)               |
| `footer`      | Source-data link, GitHub link, "Last update …"                |
| `loadError`   | Banner shown when `metrics.json` fails to load                |
| `tabs`        | ARIA labels around the tab strip                              |
| `infoTooltip` | Fallback ARIA label on every "i" icon                         |
| `chartLegend` | ARIA label on legend toggle buttons                           |
| `overview`    | The three cards (Entries / Unique ASes / Drift)               |
| `history`     | Range picker, drift charts, entries chart, delta chart        |
| `diff`        | Diff Explorer selectors, classification breakdown, banner     |
| `topMovers`   | Top Movers table column headers, filters, tooltips            |
| `common`      | Shared phrases used in more than one namespace                |

Inside a namespace, keys are nested as deep as they need to be to read
naturally:

```
overview.entries.label            # "Entries"
overview.entries.deltaVsPrevious  # "{delta} vs previous"
topMovers.columns.changes         # "Changes"
topMovers.direction.tooltip.gained
```

The grouping is the editor's compass. If you want to rename a column,
you go to `topMovers.columns`. If you want to change a card tooltip,
you go to `<card>.info`.

## Placeholders: `{name}` substitutions

Strings that need a runtime value carry **named placeholders** in
curly braces:

```json
"deltaVsPrevious": "{delta} vs previous"
"entriesAndSize":  "{count} entries ({size})"
"sort": {
    "activeAria": "Sort by {column}, currently {direction}"
}
```

The dashboard substitutes the value at render time, so the user sees
`+2,343 vs previous` or `Sort by Changes, currently descending`.

Rules of the road:

- **Keep every placeholder you find in the original.** Removing
  `{count}` from `"{count} days old"` would render literally
  `days old`.
- **Reorder them freely.** A translation can move them anywhere it
  needs:
  `"Sort by {column}, currently {direction}"` →
  `"Sortiert nach {column}, aktuell {direction}"`.
- **You can introduce new ones** as long as you also add them in the
  code path that calls the key (let the dev know in the PR; they will
  add the missing variable).
- **Unknown placeholders survive as-is.** A typo like `{contterpart}`
  renders verbatim so it is immediately visible.

## Multi-paragraph tooltips: the `info` arrays

The big info popovers (the "i" icons next to the Overview cards, the
chart titles, the Top Movers card, the Diff Explorer card) read from
an **array** instead of a single string. Each entry is one paragraph:

```json
"overview": {
    "entries": {
        "info": [
            "Each entry maps an IP prefix to the autonomous system that announces it.",
            "Read from the unfilled (source data) variant when published, falling back to the filled variant otherwise.",
            "The vs-previous delta is only shown when both sides come from the same encoding. …",
            "On-disk file size rides along inside the entries-chart tooltip."
        ]
    }
}
```

Some popovers add a **lead-in label** in front of a paragraph. For
that, the entry becomes a small object instead of a plain string:

```json
"info": [
    "Each entry-level change between Map A and Map B falls into exactly one of three buckets.",
    {
        "lead": "Reassigned.",
        "text": "A prefix was mapped in both Map A and Map B, but now resolves to a different autonomous system."
    },
    {
        "lead": "Newly Mapped.",
        "text": "A prefix had no autonomous system in Map A and now resolves to one in Map B."
    }
]
```

The renderer makes `lead` bold and runs `text` after it. To add a new
paragraph, append a new array element. To drop one, remove the
element. The order in the JSON is the order on screen.

## Pluralisation

Strings that change shape with a number live in a tiny object instead
of a flat key:

```json
"staleness": {
    "one":   "1 day old",
    "other": "{count} days old"
}
```

The dashboard automatically picks the right form based on the count
**and** the locale: English uses `one` and `other`, Russian / Polish /
Arabic use more. To localise, add whatever forms the target language
needs (see [the CLDR plural rules](https://cldr.unicode.org/index/cldr-spec/plural-rules)
for the exact set).

Today only `overview.staleness` uses this shape; if you add a new
plural string, tell the dev so they can wire it up with `tPlural()`
on the JS side.

## Adding a new language

1. Copy `en.json` to a new file named after the locale tag, e.g.
   `de.json`.
2. Update the `_meta` block:

    ```json
    "_meta": {
        "language": "de",
        "name": "Deutsch",
        "version": "1"
    }
    ```

3. Translate the values. Keep keys and placeholders untouched.
4. Reload the dashboard. Anything you missed shows up as a literal
   key placeholder on screen plus a `i18n: missing key` warning in the
   browser console.

The dashboard's bootstrap reads exactly one locale file today; the
locale picker is a follow-up change. The dev wiring it up will add a
selector to the header, which then loads `de.json` instead of
`en.json`.

## Things the dictionary does *not* cover

A few things look like text but are owned by something other than the
i18n file. If you find yourself wanting to edit one of these, the file
to touch lives in code:

- **Numbers, dates and percentages.** `455,725`, `Mar 5, 2026`,
  `5.0 %` come from the browser's `Intl` formatting and follow the
  active locale automatically.
- **AS operator names** (`AS16509 — Amazon`). They live in
  `web/assets/data/asn-names.json`, refreshed nightly from bgp.tools.
- **The dashboard's URL and link targets.** Those are HTML attributes
  in `web/index.html`, not user-facing copy.
- **Internal log messages** that surface in the browser's devtools
  console. They are for developers and stay in English.

## File format rules

JSON is strict; small mistakes break the whole file. The validator
will tell you exactly where, but if you want to avoid the trip:

- **UTF-8, no BOM.** Any modern editor (VS Code, Sublime, vim) does
  this by default.
- **Double quotes only** (`"key"`, never `'key'`).
- **No trailing commas.** `{"a": 1, "b": 2,}` is invalid JSON.
- **No comments.** JSON has none. If you need to explain something,
  put it here in this README, or open an issue.

If the dashboard renders a literal key placeholder (e.g.
`overview.entries.lable`) instead of the expected text, your JSON
either misnamed the key or removed a path the code still reads from.
The browser console carries a `i18n: missing key` warning with the
exact path, so the fix is usually a one-character correction.

## When in doubt

Open an issue or DM. Most edits are "find the line, change the line";
the dashboard's "missing key" fallback keeps mistakes loud and cheap.
