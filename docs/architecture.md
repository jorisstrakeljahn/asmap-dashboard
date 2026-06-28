# Architecture

Start here for the big picture. This is the one-screen map of how data flows through the project, where each piece lives, and which design decisions are deliberate. For setup and commands see the [README](../README.md); for the *why* behind a specific number, the inline docstrings next to that number are the source of truth (this doc only points at them).

## Data flow

```
bitcoin-core/asmap-data        snapshots/ (KIT + Bitnodes, private)
  <year>/<ts>_asmap.dat          *_dossier.json / <ts>.json
  <year>/<ts>_asmap_unfilled.dat        │
        │                               │
        ▼                               ▼
  asmap_dashboard/  ── Python pipeline (stdlib only) ──┐
    metrics.py      profile every build, diff every pair │
    diff.py         classify prefix changes              │
    network/        score observed nodes vs build history│
        │                                                │
        ▼                                                ▼
   three JSON payloads (schema_version-stamped)   bgp.tools/asns.csv
    metrics.json ~110 KB  profiles + diff summary        │
    diffs.json    ~4 MB   per-pair top-mover rosters      ▼
    network.json  ~70 KB  observed-node metrics    asn-names.json
        │                                          (ASN -> operator)
        ▼
  web/  ── static ES-module frontend (no build step) ──
    app.js     fetch metrics+network, check schema_version, mount tabs
    maps-tab   overview cards + history charts (from the diff summary)
    diff-tab   diff explorer + top movers (lazy-loads diffs.json)
    network-tab snapshot hero + trend charts + cross-check
```

`metrics.json`, `diffs.json`, and `asn-names.json` are rebuilt on every deploy and are not tracked in git. `network.json` is committed because the snapshots behind it are not public yet - see the reproducibility note in the [README](../README.md#how-it-works).

## Module map

### Pipeline (`asmap_dashboard/`)

| Module | Responsibility |
| --- | --- |
| `cli.py` | Argparse entry point; one `_run_*` per subcommand. |
| `metrics.py` | Build discovery, all-pairs diff orchestration, payload assembly, `SCHEMA_VERSION`. |
| `analyze.py` | Per-build profile (entries, unique ASes, IPv4/IPv6 split). |
| `diff.py` | Two-map diff: reassigned / newly-mapped / unmapped, top movers, optional `--addrs` node impact. |
| `loader.py` | Parse one `.dat` into an `ASMap` plus the per-ASN caches the diff reuses. |
| `netgroup.py` | Bitcoin Core `GetGroup()` default buckets + `GetLinkedIPv4()` unwrap. |
| `_prefix.py` | Prefix/range arithmetic shared by diff and metrics. |
| `network/snapshots.py` | Source-agnostic snapshot loading (KIT, Bitnodes). |
| `network/metrics.py` | The seven network-tap metrics (glossary below). |

### Frontend (`web/assets/js/`)

| Area | Responsibility |
| --- | --- |
| `app.js` | Bootstrap: parallel fetch, schema check, tab mounting. |
| `tabs.js` | Hash-based router (leading `#token` only). |
| `utils/hash-state.js` | Per-tab `#tab?query` state for sharable permalinks. |
| `utils/history-range.js` | The single 1Y/3Y/5Y/Max range resolver. |
| `format.js` | Number/percent/date formatting, all pinned to UTC. |
| `maps-tab.js` + `components/` | Overview cards and history charts. |
| `diff-tab.js` + `components/diff-explorer/`, `top-movers/` | Diff explorer. |
| `network-tab.js` + `components/network/` | Snapshot hero, trend charts, cross-check. |
| `charts/` | Imperative SVG line/bar chart primitives (no lit-html; see the rendering decision below). |
| `vendor/lit-html.js` | Committed copy of lit-html, the renderer for all data-driven DOM. Refresh with `npm run vendor:lit`. |
| `web/tests/` | `node --test` unit tests for the pure JS logic (range/sort/diff/geometry) plus a lit-html drift guard. Run with `npm test`. |

## URL structure

Routing is hash-only - the query string (`?...`) is never read by the app. Canonical forms:

- `.../asmap-dashboard/` - Maps tab (default), no fragment.
- `#maps?range=3y` - Maps history range.
- `#diff?a=YYYY-MM-DD&b=YYYY-MM-DD` - a shared Map A / Map B pair.
- `#network?range=5y&axis=date&family=ipv6` - Trends range + decay axis + HHI family.

Only non-default state is written to the hash, so a default view carries a bare `#tab` (or no fragment at all on the default tab). Every hash parameter is validated before use - ranges/axes/families against fixed allowlists, `a`/`b` against the real build release dates - so an arbitrary or hand-edited fragment falls back to the default rather than flowing into a lookup. A `?query` before the `#` is inert.

## Design decisions

The deliberate choices, each with the trade-off that justified it, so intent never has to be reverse-engineered from the code.

- **No frontend framework; one vendored renderer, no build step.** Plain HTML and ES modules plus a single committed copy of lit-html (`web/assets/js/vendor/lit-html.js`, ~3 KB, no LitElement/decorators). Templates read like the markup they produce, yet the page still works over `file://`, needs no bundler, and deploys to GitHub Pages as-is. lit-html is vendored rather than fetched from a CDN so the dashboard keeps working offline for years; `npm run vendor:lit` re-fetches it and `dependencies.lit-html` in `package.json` pins the verified version. This is the one runtime dependency: there is still no bundler and no transitive package tree.
- **lit-html renders data-driven DOM; stateful widgets and charts stay imperative.** Anything that rebuilds from data - overview cards, the top-movers table, diff breakdowns, explanatory paragraphs - is a lit template, so the markup is declarative and lit is the *single writer* of that node (mixing lit `render()` with `innerHTML`/`replaceChildren` on the same node corrupts lit's part bookkeeping, so each node has exactly one renderer). Stateful, measurement-driven controls (`components/dropdown.js`, `info-tooltip.js`, `mode-switch.js`) and the SVG `charts/` stay imperative: they build their DOM once, then hold element references to measure geometry, run open/close transitions and manage ARIA state, where core lit-html (no reactive controllers) would only add ref-juggling. `mutedNote()` and `createChartLede()` deliberately return DOM nodes, not templates, because both layers consume them - `render(node, ...)` *and* `replaceChildren(node)`. `renderToElement(template)` (`utils/dom.js`) is the bridge the other way: it renders a one-shot lit template into a throwaway holder and hands back the real (single-root) element for imperative code to own.
- **Hash-only routing; the query string is ignored.** Hashes survive reloads and `file://` loads with no server rewrites, and every hash parameter is validated against an allowlist (or real build dates) before use, so a hand-edited fragment falls back to the default instead of reaching a lookup.
- **Three split payloads, with the heavy one lazy.** `metrics.json` (~110 KB: profiles + the per-pair diff summary) drives the first paint, including every drift chart. The ~4 MB `diffs.json` holds only the top-mover rosters and is fetched the first time the Diff Explorer tab is opened, so the overview never downloads or parses it.
- **Every payload carries a `schema_version`.** A stale cached `app.js` meeting a fresh payload becomes an explicit reload banner instead of silently wrong numbers; the constant is pinned in both languages by a contract test.
- **Frontend tests cover the pure logic; rendering is reviewed.** `npm test` runs Node's built-in `node:test` over the brittle, high-value math - range resolution, the top-movers sort/classification, diff lookups, bar geometry, variant selection - plus a guard that the vendored lit-html still matches the `package.json` pin. No Jest/Vitest, no jsdom, nothing to install: only functions that need no `document` are tested, so they import straight into Node, matching the no-build-step ethos. DOM rendering is verified in review and the browser.
- **All dates are UTC.** Build times are parsed and compared on the UTC grid, so a build never renders on a different calendar day for viewers in different timezones.
- **Diffs are unfilled-vs-unfilled.** Comparing the source variants isolates real BGP / RPKI / IRR drift from the rebalancing the `--fill` heuristic introduces; pairs without an unfilled side are shown as a gap, never a misleading number.
- **The all-pairs diff is precomputed (O(N²)).** Every pair is diffed up front so the Diff Explorer pivots to any (A, B) with no backend; the cost budget and switch point live at the diff site in `metrics.py`.
- **`network.json` is the one committed artefact.** Its KIT inputs are not public, so CI cannot regenerate or verify it - it must be rebuilt locally after any network-pipeline change (see the [README](../README.md#how-it-works)).

## The seven network-tap metrics

All derived from the same normalised `Snapshot` stream so every number traces back to a public input. Full rationale lives in the `asmap_dashboard/network/metrics.py` module docstring; this is the index.

1. **Map staleness / decay** - for one fixed node set, how many nodes resolve to a different ASN under each build vs the newest build, plotted against build age. Answers "how stale is an N-day-old map?".
2. **AS concentration (HHI)** - Herfindahl-Hirschman index over the ASes the in-effect build assigns the observed nodes. Lower = more diverse.
3. **Bucketing effectiveness** - distinct peer-diversity buckets under ASmap vs Core's default /16-/32 bucketing; the reduction ratio is the security-relevant number.
4. **NetGroup diversity over time** - metric 3's ASmap-bucket count as its own time series.
5. **ASN attribution cross-check** - share of crawler-whois ASNs that agree with the ASmap lookup; a data-quality signal.
6. **ASmap coverage of observed nodes** - share of clearnet nodes the in-effect build maps to a real AS at all.
7. **ASes to reach 50%** - minimum number of ASes holding ≥ 50 % of the mapped nodes; the blunt adversarial reading. (Decentralisation studies call this the AS Nakamoto coefficient; the dashboard and pipeline use the plain name end to end.)

Every per-snapshot metric is additionally split by *effective* address family (after the linked-IPv4 unwrap, mirroring Core's `GetGroup()`).
