# Dashboard copy

Every user-facing string lives in this folder as plain JSON. Edit a value, save, reload — no JavaScript involved.

`en.json` is the only locale today. Future languages (`de.json`,
`es.json`, …) drop in next to it.

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

- **`_meta`** carries the locale tag and a version marker. Leave them alone unless you are forking the file for a new language.
- The other top-level keys are **namespaces**. They mirror the surfaces in the dashboard:

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

Inside a namespace, keys are nested as deep as they need to be to read naturally:

```
overview.entries.label            # "Entries"
overview.entries.deltaVsPrevious  # "{delta} vs previous"
topMovers.columns.changes         # "Changes"
topMovers.direction.tooltip.gained
```

Rules of the road:

- **Keep every placeholder you find in the original.** Removing `{count}` from `"{count} days old"` would render literally `days old`.
- **Reorder them freely.** A translation can move them anywhere it needs:
  `"Sort by {column}, currently {direction}"` →
  `"Sortiert nach {column}, aktuell {direction}"`.
- **You can introduce new ones** as long as you also add them in the code path that calls the key (let the dev know in the PR; they will add the missing variable).
- **Unknown placeholders survive as-is.** A typo like `{contterpart}` renders verbatim so it is immediately visible.

## Chart explainers: the `lede`

The big History and Network charts explain themselves with a single always-visible **`lede`** under the title, a short, plain-language summary that should make the chart understandable on its own, even for someone new to ASmap. The ledes are written to build on each other top-to-bottom within a tab, so earlier charts introduce a term and later ones reuse it without repeating the definition.

Each tab also opens with a **`sectionLede`** under its section title. That one sets the context for the whole tab (what ASmap is, what this tab measures); the per-chart ledes then explain the individual charts.

The exhaustive methodology and edge cases are intentionally **not** rendered under each chart; that depth belongs on asmap.org. The chart-level `info` arrays are kept in this file as the source for that future migration, but nothing renders them right now.

The compact Overview / Network metric cards still use the "i" popover (`info` + `infoAria`), since there is no room for a lede under each.

## Multi-paragraph bodies: the `info` arrays

The deep explainers (the "i" popovers on the Overview cards, the Top Movers card, the Diff Explorer card; plus the reserved chart `info` blocks above) read from an **array** instead of a single string. Each entry is one paragraph:

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

Some popovers add a **lead-in label** in front of a paragraph. For that, the entry becomes a small object instead of a plain string:

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

The renderer makes `lead` bold and runs `text` after it. To add a new paragraph, append a new array element. To drop one, remove the element. The order in the JSON is the order on screen.

## Pluralisation

Strings that change shape with a number live in a tiny object instead of a flat key:

```json
"staleness": {
    "one":   "1 day old",
    "other": "{count} days old"
}
```