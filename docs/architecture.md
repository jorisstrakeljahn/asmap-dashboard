# Architecture

Start here for the big picture. This is the one-screen map of how data flows through the project, where each piece lives, and which design decisions are deliberate. For setup and commands see the [README](../README.md); for what each number means (data sources, per-metric inputs, calculation, caveats) see [metrics.md](metrics.md); for exact formulas, the inline docstrings next to each number are the source of truth.

## Data flow

```
┌────────────────────────────────┐     ┌────────────────────────────────────────┐
│  bitcoin-core/asmap-data       │     │  node snapshots                        │
│    <year>/<ts>_asmap.dat       │     │    network-snapshots release           │
│    <year>/<ts>_asmap_unfilled  │     │    bitnodes.io archive + bitnod.es     │
│                                │     │    (fetch-bitmex.yml, daily)           │
└───────────────┬────────────────┘     └──────────────────┬─────────────────────┘
                │                                         │
                │                                         │
                ▼                                         ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│  asmap_dashboard/              Python pipeline (stdlib only)                  │
│                                                                               │
│    metrics command     profile builds and diff every pair                     │
│    network command     score nodes without prefix diffs                       │
│    network/whois       Team Cymru query + private TTL cache                   │
└───────────────┬───────────────────────────────────────────────┬───────────────┘
                │                                               │
                │                                               ▼
                │                                      bgp.tools/asns.csv
                │                                               │
                ▼                                               ▼
┌─────────────────────────────────────────────┐    ┌────────────────────────────┐
│  JSON payloads (schema_version-stamped)     │    │  asn-names.json            │
│                                             │    │    ASN → operator labels   │
│    metrics.json   ~110 KB                   │    └────────────────────────────┘
│      profiles + diff summary                │
│    diffs.json     ~4 MB                     │
│      per-pair top-mover rosters             │
│    network.json   ~70 KB                    │
│      observed-node metrics                  │
└─────────────────────┬───────────────────────┘
                      │
                      │
                      ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│  web/                          static ES-module frontend (no build step)      │
│                                                                               │
│    app.js          fetch metrics+network, schema_version check, mount tabs    │
│    maps-tab        overview cards + history charts (from the diff summary)    │
│    diff-tab        diff explorer + top movers (lazy-loads diffs.json)         │
│    network-tab     snapshot hero + trend charts + cross-check                 │
└───────────────────────────────────────────────────────────────────────────────┘
```

The generated payloads are not tracked in git. GitHub Actions caches `metrics.json` and `diffs.json` by asmap-data revision, schema, and map-analysis code. The daily `network` command parses the maps but skips the expensive prefix-diff pass. It rebuilds `network.json` from the public snapshots and refreshes Team Cymru records older than 24 hours.

## Module map

### Pipeline (`asmap_dashboard/`)

| Module | Responsibility |
| --- | --- |
| [`cli.py`](../asmap_dashboard/cli.py) | Argparse entry point; one `_run_*` per subcommand. |
| [`metrics.py`](../asmap_dashboard/metrics.py) | Build discovery, all-pairs diff orchestration, payload assembly, `SCHEMA_VERSION`. |
| [`analyze.py`](../asmap_dashboard/analyze.py) | Per-build profile (entries, unique ASes, IPv4/IPv6 split). |
| [`diff.py`](../asmap_dashboard/diff.py) | Two-map diff: reassigned / newly-mapped / unmapped, top movers, optional `--addrs` node impact. |
| [`loader.py`](../asmap_dashboard/loader.py) | Parse one `.dat` into an `ASMap` plus the per-ASN caches the diff reuses. |
| [`netgroup.py`](../asmap_dashboard/netgroup.py) | Bitcoin Core `GetGroup()` default buckets + `GetLinkedIPv4()` unwrap. |
| [`_prefix.py`](../asmap_dashboard/_prefix.py) | Prefix/range arithmetic shared by diff and metrics. |
| [`network/snapshots.py`](../asmap_dashboard/network/snapshots.py) | Bitnodes archive/CSV loading and normalisation. |
| [`network/metrics.py`](../asmap_dashboard/network/metrics.py) | The network-tap metrics (catalogued in [metrics.md](metrics.md)). |
| [`network/whois.py`](../asmap_dashboard/network/whois.py) | Team Cymru bulk WHOIS client plus TTL and negative cache. |

### Frontend (`web/assets/js/`)

| Area | Responsibility |
| --- | --- |
| [`app.js`](../web/assets/js/app.js) | Bootstrap: parallel fetch, schema check, tab mounting. |
| [`tabs.js`](../web/assets/js/tabs.js) | Hash-based router (leading `#token` only). |
| [`utils/hash-state.js`](../web/assets/js/utils/hash-state.js) | Per-tab `#tab?query` state for sharable permalinks. |
| [`utils/history-range.js`](../web/assets/js/utils/history-range.js) | The single 1Y/3Y/5Y/Max range resolver. |
| [`format.js`](../web/assets/js/format.js) | Number/percent/date formatting, all pinned to UTC. |
| [`maps-tab.js`](../web/assets/js/maps-tab.js) + `components/` | Overview cards and history charts. |
| [`diff-tab.js`](../web/assets/js/diff-tab.js) + `components/diff-explorer/`, `top-movers/` | Diff explorer. |
| [`network-tab.js`](../web/assets/js/network-tab.js) + `components/network/` | Snapshot hero, trend charts, cross-check. |
| `charts/` | Imperative SVG line/bar chart primitives (no lit-html; see the rendering decision below). |
| [`vendor/lit-html.js`](../web/assets/js/vendor/lit-html.js) | Committed copy of lit-html, the renderer for all data-driven DOM. Refresh with `npm run vendor:lit`. |
| [`web/tests/`](../web/tests/README.md) | `node --test` unit tests for the pure JS logic (range/sort/diff/geometry) plus a lit-html drift guard. Run with `npm test`. |

## URL structure

Routing is hash-only - the query string (`?...`) is never read by the app. Canonical forms:

- `.../asmap-dashboard/` - Maps tab (default), no fragment.
- `#maps?range=3y` - Maps history range.
- `#diff?a=YYYY-MM-DD&b=YYYY-MM-DD` - a shared Map A / Map B pair.
- `#network?range=5y&axis=date&family=ipv6` - Trends range + decay axis + HHI family.

Only non-default state is written to the hash, so a default view carries a bare `#tab` (or no fragment at all on the default tab). Every hash parameter is validated before use - ranges/axes/families against fixed allowlists, `a`/`b` against the real build release dates - so an arbitrary or hand-edited fragment falls back to the default rather than flowing into a lookup. A `?query` before the `#` is inert.

## Design decisions

The deliberate choices, each with the trade-off that justified it, so intent never has to be reverse-engineered from the code.

- **No frontend framework; one vendored renderer, no build step.** Plain HTML and ES modules plus a single committed copy of lit-html ([`web/assets/js/vendor/lit-html.js`](../web/assets/js/vendor/lit-html.js), ~3 KB, no LitElement/decorators). Templates read like the markup they produce, yet the page still works over `file://`, needs no bundler, and deploys to GitHub Pages as-is. lit-html is vendored rather than fetched from a CDN so the dashboard keeps working offline for years; `npm run vendor:lit` re-fetches it and `dependencies.lit-html` in [`package.json`](../package.json) pins the verified version. This is the one runtime dependency: there is still no bundler and no transitive package tree.
- **lit-html renders data-driven DOM; stateful widgets and charts stay imperative.** Anything that rebuilds from data - overview cards, the top-movers table, diff breakdowns, explanatory paragraphs - is a lit template, so the markup is declarative and lit is the *single writer* of that node (mixing lit `render()` with `innerHTML`/`replaceChildren` on the same node corrupts lit's part bookkeeping, so each node has exactly one renderer). Stateful, measurement-driven controls ([`components/dropdown.js`](../web/assets/js/components/dropdown.js), [`info-tooltip.js`](../web/assets/js/components/info-tooltip.js), [`mode-switch.js`](../web/assets/js/components/mode-switch.js)) and the SVG `charts/` stay imperative: they build their DOM once, then hold element references to measure geometry, run open/close transitions and manage ARIA state, where core lit-html (no reactive controllers) would only add ref-juggling. `mutedNote()` and `createChartLede()` deliberately return DOM nodes, not templates, because both layers consume them - `render(node, ...)` *and* `replaceChildren(node)`. `renderToElement(template)` ([`utils/dom.js`](../web/assets/js/utils/dom.js)) is the bridge the other way: it renders a one-shot lit template into a throwaway holder and hands back the real (single-root) element for imperative code to own.
- **Hash-only routing; the query string is ignored.** Hashes survive reloads and `file://` loads with no server rewrites, and every hash parameter is validated against an allowlist (or real build dates) before use, so a hand-edited fragment falls back to the default instead of reaching a lookup.
- **Three split payloads, with the heavy one lazy.** `metrics.json` (~110 KB: profiles + the per-pair diff summary) drives the first paint, including every drift chart. The ~4 MB `diffs.json` holds only the top-mover rosters and is fetched the first time the Diff Explorer tab is opened, so the overview never downloads or parses it.
- **Every payload carries a `schema_version`.** A stale cached `app.js` meeting a fresh payload becomes an explicit reload banner instead of silently wrong numbers; the constant is pinned in both languages by a contract test.
- **Frontend tests cover the pure logic; rendering is reviewed.** `npm test` runs Node's built-in `node:test` over the brittle, high-value math - range resolution, the top-movers sort/classification, diff lookups, bar geometry, variant selection - plus a guard that the vendored lit-html still matches the [`package.json`](../package.json) pin. No Jest/Vitest, no jsdom, nothing to install: only functions that need no `document` are tested, so they import straight into Node, matching the no-build-step ethos. DOM rendering is verified in review and the browser.
- **All dates are UTC.** Build times are parsed and compared on the UTC grid, so a build never renders on a different calendar day for viewers in different timezones.
- **Diffs are unfilled-vs-unfilled.** Comparing the source variants isolates real BGP / RPKI / IRR drift from the rebalancing the `--fill` heuristic introduces; pairs without an unfilled side are shown as a gap, never a misleading number.
- **The all-pairs diff is precomputed (O(N²)).** Every pair is diffed up front so the Diff Explorer pivots to any (A, B) with no backend; the cost budget and switch point live at the diff site in [`metrics.py`](../asmap_dashboard/metrics.py).
- **One public crawler lineage, with an explicit handoff.** Archived bitnodes.io snapshots and daily bitnod.es CSV exports share one source id and line. Snapshot-time charts mark where the export host and format changed.
- **WHOIS is independent from ASmap and private by construction.** The pipeline queries Team Cymru for the latest snapshot only. Raw IP-to-ASN records live in a gitignored cache and never enter the Pages artifact. The Reality curve and cross-check require sufficient current coverage; they never substitute an ASmap lookup or apply today's routing to old CSV snapshots.
- **Map diffs and daily network scoring have separate commands.** Prefix diffs rebuild when their inputs change. Daily node scoring reuses cached map payloads and runs without `_compute_pair_diffs`.

## Metrics

The per-metric glossary (inputs, calculation, worked examples, caveats, code pointers) lives in [metrics.md](metrics.md). All network metrics derive from the same normalised `Snapshot` stream, so every number traces back to a public input; every per-snapshot metric is additionally split by *effective* address family (after the linked-IPv4 unwrap, mirroring Core's `GetGroup()`).
