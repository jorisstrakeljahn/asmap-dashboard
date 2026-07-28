# Metrics

The dashboard profiles every ASmap build published in [bitcoin-core/asmap-data](https://github.com/bitcoin-core/asmap-data), diffs every pair of builds, and scores observed Bitcoin nodes against the build history. This document explains what each number on the site means. It covers the data sources first, then the three tabs in UI order (Maps, Network, Diff Explorer) metric by metric, then which metrics belong together and where the data stops. For data flow and module layout see [architecture.md](architecture.md); for exact formulas the linked code is the authority.

## Data sources

Five inputs feed the site. Three comparisons connect them:

| Comparison | Sides | Used by |
| --- | --- | --- |
| map vs map | unfilled variant of build A vs build B | Maps history charts, Diff Explorer |
| nodes vs map | one crawler snapshot vs the build in effect at its time | Network per-snapshot metrics; held fixed against every build for the decay curves and pair impact |
| WHOIS vs map | Team Cymru BGP origin ASN vs the ASmap lookup, per node | ASN attribution agreement, Reality decay curve |

bgp.tools contributes labels only. It never enters a number.

### asmap-data builds

- **Role:** the object under study. Each build is one published ASmap: a binary trie mapping IP prefixes to the autonomous system (AS) that announces them. Bitcoin Core embeds these maps to bucket peers by network operator instead of by /16.
- **Origin:** a git checkout of bitcoin-core/asmap-data, discovered by filename under four-digit year directories. The release date comes from the filename timestamp, not git history.
- **Format:** Bitcoin Core's binary asmap encoding. Two variants per build: `<ts>_asmap_unfilled.dat` is the raw upstream prefix data (RPKI / IRR / Routeviews) and the canonical source; `<ts>_asmap.dat` is the same data after `asmap-tool encode --fill` merged adjacent same-AS prefixes, the form Core embeds. Filled derives from unfilled deterministically; the reverse is impossible. Some builds published only one variant.
- **Example:** the files are binary, so here is the on-disk layout plus the profile the pipeline reads out of one:

```
asmap-data/2026/1783008000_asmap.dat            # filled, 1,556,546 bytes
asmap-data/2026/1783008000_asmap_unfilled.dat   # unfilled, 1,905,101 bytes

$ python -m asmap_dashboard analyze asmap-data/2026/1783008000_asmap_unfilled.dat
{
  "entries_count": 466771,
  "unique_asns": 91466,
  "ipv4_count": 369939,
  "ipv6_count": 96832,
  ...
}
```

- **Not in the source:** operator names (bgp.tools supplies those), release metadata beyond the filename timestamp. ASN 0 means "no AS opinion", not an operator.
- **Privacy:** fully public upstream data.
- **Code:** discovery [`asmap_dashboard/metrics.py::discover_maps`](../asmap_dashboard/metrics.py), parsing [`asmap_dashboard/loader.py`](../asmap_dashboard/loader.py) over the vendored [`asmap_dashboard/_vendor/asmap.py`](../asmap_dashboard/_vendor/asmap.py), profiling [`asmap_dashboard/analyze.py::analyze_loaded_map`](../asmap_dashboard/analyze.py).

### Bitnodes crawler lineage

- **Role:** the observed node population. Answers "where do reachable Bitcoin nodes actually sit?" so map metrics can be scored against real peers instead of address space.
- **Origin:** one crawler lineage in two stages. Archived bitnodes.io JSON crawls cover January 2024 to spring 2026; daily [bitnod.es](https://bitnod.es) (BitMEX Research) CSV exports continue the series, appended nightly to the `network-snapshots` release by [`.github/workflows/fetch-bitmex.yml`](../.github/workflows/fetch-bitmex.yml). Both stages share the source id `bitnodes`; a `lineage_stage` field records the handoff so charts can mark it without splitting the series.
- **Format:** three shapes, dispatched on file type. Archived JSON comes as a dict (`{"timestamp", "nodes": {addr: [fields]}}`) or as a bare list of rows where index 13 carries the crawler's ASN and index 9 the country:

```
["2a01:4f8:c0c:ce05::1", 8333, 70016, "/Satoshi:23.0.0/", ..., "DE", ..., "AS24940", "Hetzner Online GmbH"]
["jqim...onion", 8333, 70016, "/Satoshi:23.0.0/", ..., null, ..., "TOR", "Tor network"]
```

The CSV is a cumulative "last seen" dump; capture time is the newest embedded `export_date`, and only rows within one day of it are kept so the set matches one crawl (~9.7k clearnet nodes) instead of the inflated rolling window:

```
"export_date","ip_address","port","country","isp","services","protocol_version","user_agent","block_height"
"2026-07-03","1.1.164.237","8333","Thailand","TOT Public Company Limited","3081","70016","/Satoshi:29.0.0/","956458"
"2026-05-23","1.1.171.38","8333","Thailand","TOT Public Company Limited",...     <- stale tail, dropped by the window
"2026-06-23","zzunzh3...onion","8333","Unknown","Unknown",...                    <- onion, dropped at load
```

- **Not in the source:** the CSV has no ASN column (only a free-text `isp`), so live nodes carry no attribution until WHOIS annotates them. Onion, I2P, and CJDNS peers have no IP for ASmap to resolve and are dropped at load; per-snapshot skip counters preserve how many.
- **Privacy:** public data. Node IPs of reachable peers are published by the crawler itself.
- **Code:** [`asmap_dashboard/network/snapshots.py`](../asmap_dashboard/network/snapshots.py) (`load_bitnodes_snapshot`, `load_bitnodes_csv`, `discover_snapshots`), fetch workflow [`.github/workflows/fetch-bitmex.yml`](../.github/workflows/fetch-bitmex.yml).

### Team Cymru IP-to-ASN

- **Role:** independent per-node attribution. Answers "which AS does BGP say this node's address originates from right now?", which the cross-check and the Reality decay curve compare against the ASmap lookup.
- **Origin:** the daily build sends the newest snapshot's clearnet IPs to [Team Cymru's bulk WHOIS service](https://www.team-cymru.com/ip-asn-mapping) (`whois.cymru.com:43`). Only the newest snapshot is annotated: current BGP data cannot reconstruct historical routing, so stamping old CSVs with today's origin ASN would manufacture history.
- **Format:** plain-text bulk protocol. Request and one response row:

```
begin
verbose
203.0.113.7
end

64496   | 203.0.113.7      | 203.0.113.0/24      | DE | ripencc | 2010-01-12 | EXAMPLE-AS
```

The parser keeps the AS number, IP, and country code; rows with ambiguous origin sets or banner text are skipped. A 24-hour local cache (`cache/whois/records.json`) stores hits and timestamped misses:

```
{"records":{"203.0.113.7":{"asn":64496,"checked_at":1784800000,"country":"DE"}},"misses":{"198.51.100.9":1784800000}}
```

- **Not in the source:** geolocation. The country field is RIR allocation metadata, so it never overrides the crawler's country value and is not used as GeoIP.
- **Privacy:** the cache contains raw node IPs. It is gitignored, kept outside the Pages artifact, and only aggregate counts reach the public payloads. The Pages deploy aborts below 50 % Team Cymru coverage rather than shipping thin attribution.
- **Code:** [`asmap_dashboard/network/whois.py`](../asmap_dashboard/network/whois.py) (`TeamCymruWhoisResolver`, `CachedWhoisResolver`, `JsonWhoisStore`), annotation [`asmap_dashboard/network/snapshots.py::annotate_snapshot`](../asmap_dashboard/network/snapshots.py).

### bgp.tools ASN names

- **Role:** turns `AS24940` into `AS24940 (Hetzner Online GmbH)` in the UI. Labels only.
- **Origin:** `https://bgp.tools/asns.csv`, fetched at build time by the `refresh-asn-names` command and filtered to the ASNs the payloads actually reference (a few kilobytes instead of ~5 MB).
- **Format:** CSV; the command reads the `asn` and `name` columns and ignores the rest:

```
asn,name,class
AS14618,"Amazon.com, Inc.",...
AS24940,"Hetzner Online GmbH",...
AS63949,"Akamai Connected Cloud",...
```

- **Not in the source:** anything the metrics use. A missing file downgrades labels to bare `AS<n>`; no number changes.
- **Code:** [`asmap_dashboard/asn_names.py::refresh`](../asmap_dashboard/asn_names.py), consumer [`web/assets/js/asn-names.js`](../web/assets/js/asn-names.js).

### Generated payloads

The pipeline emits four JSON files, none tracked in git, all stamped with a `schema_version` the frontend checks before rendering (a stale cached `app.js` meeting a fresh payload shows a reload banner instead of wrong numbers):

| File | Size | Contents | Read by |
| --- | --- | --- | --- |
| `metrics.json` | ~110 KB | per-build profiles + all-pairs diff summary | first paint; Maps tab, drift charts, Diff Explorer banner |
| `diffs.json` | ~4 MB | per-pair top-mover rosters keyed `"<from>\|<to>"` | Top Movers table, lazy-loaded on first Diff Explorer open |
| `network.json` | ~70 KB | per-snapshot node metrics, decay curves, node-impact aggregates | Network tab; Diff Explorer node-impact banner |
| `asn-names.json` | a few KB | ASN to operator-name subset | labels everywhere |

A `metrics.json` build entry, abridged:

```json
{
  "name": "2026/1783008000",
  "released_at": "2026-07-02",
  "unfilled": {"present": true, "entries_count": 466771, "unique_asns": 91466, ...},
  "filled":   {"present": true, "entries_count": 408988, ...}
}
```

When `network.json` is absent the Network tab stays hidden. The payloads carry only aggregates, never node addresses. `network.json` and `diffs.json` wrap their content under a top-level key (`network` / `top_movers`); the JSON paths quoted per metric below start inside that wrapper.

- **Code:** assembly [`asmap_dashboard/metrics.py::generate_dashboard_data`](../asmap_dashboard/metrics.py), split and emission [`asmap_dashboard/cli.py::_run_metrics`](../asmap_dashboard/cli.py) / `_run_network`, schema check [`web/assets/js/app.js`](../web/assets/js/app.js).

### Filled vs unfilled policy

The dashboard prefers the unfilled variant everywhere a number is computed. Filled-vs-filled comparisons would conflate real BGP / RPKI / IRR shifts with the rebalancing the fill heuristic does whenever adjacent same-AS prefixes appear or disappear. Concretely:

- Overview cards read the unfilled profile and fall back to filled with a visible badge when a build published only that.
- All pair diffs are unfilled vs unfilled. A pair missing the unfilled variant on either side is skipped and rendered as a gap, never as a number.
- Network lookups prefer unfilled but accept filled, because filling never changes a lookup result (it only merges adjacent same-AS prefixes).
- The entries chart shows both variants side by side: filled answers "what does Core embed?", unfilled answers "how much source data backed it?".

## Maps tab

Purpose: profile each build and show how the build history moved. Reads `metrics.json` only. Surfaces: three overview cards with a build picker, then five history charts (cumulative drift, per-release drift, distinct operators, entries over time, entries delta) windowed by a 1Y/3Y/5Y/Max range picker and an IPv4/IPv6 drift unit toggle.

### Entries (card)

- **Question:** how much raw coverage does this build carry?
- **Inputs:** `entries_count` from the build's unfilled profile; filled fallback with badge.
- **Calculation:** count of leaves in the minimal-overlapping prefix trie. No arithmetic beyond counting; `analyze_loaded_map` reads it off the loaded map.
- **Output:** `maps[].unfilled.entries_count` in `metrics.json`.
- **Example:** build 2026-07-02 has 466,771 unfilled entries and 408,988 filled ones; the ~12 % gap is fill compression, not lost data.
- **Read as:** more entries, more of the internet described by the map.
- **Do not read as:** comparable across variants. The card suppresses the "vs previous" delta when the two builds resolve to different variants, because the fill compression would read as phantom shrinkage.
- **Code:** [`asmap_dashboard/analyze.py::analyze_loaded_map`](../asmap_dashboard/analyze.py); [`web/assets/js/components/overview-cards.js::entriesCountCard`](../web/assets/js/components/overview-cards.js).

### Unique ASes (card)

- **Question:** how many distinct operators can the map distinguish?
- **Inputs:** `unique_asns` from the preferred profile; `ipv4_count` / `ipv6_count` for the split bar.
- **Calculation:** count of distinct non-zero ASNs in the map. ASN 0 (unmapped) is excluded. Variant-independent: filling merges prefixes, never ASes. The bar underneath splits mapping entries (not ASes) by address family.
- **Output:** `maps[].unfilled.unique_asns`.
- **Example:** the 2026-07-02 build references 91,466 ASes; its entries split roughly 79 % IPv4 / 21 % IPv6.
- **Read as:** each AS is one peer-diversity bucket Bitcoin Core can hold a separate connection to.
- **Do not read as:** operators actually hosting nodes. Most mapped ASes contain no Bitcoin node; the Network tab measures that side.
- **Code:** [`asmap_dashboard/analyze.py::analyze_loaded_map`](../asmap_dashboard/analyze.py); [`web/assets/js/components/overview-cards.js::uniqueAsesCard`](../web/assets/js/components/overview-cards.js).

### Drift vs previous (card)

- **Question:** how much did the map change since the last release?
- **Inputs:** the precomputed diff between this build and its most recent predecessor with an unfilled variant: `ipv4_addresses_changed`, `ipv4_address_space_union` (IPv6 pair as the secondary line).
- **Calculation:** changed address space divided by the union of both maps' mapped space for that family. The union is the one denominator every changed prefix falls under, so the ratio never exceeds 1. Families stay separate because 2^32 and 2^128 cannot be summed without IPv4 rounding to noise.
- **Output:** diff summary fields in `metrics.json` `diffs[]`; ratio computed in the frontend.
- **Example:** 2026-06-04 to 2026-07-02 moved 53,006,308 of 3,266,870,483 mapped IPv4 addresses, or 1.6 %.
- **Read as:** real source-data drift (BGP / RPKI / IRR), since the diff is unfilled vs unfilled.
- **Do not read as:** a per-day rate. Release gaps vary; a big number after a long pause is mostly elapsed time.
- **Code:** [`asmap_dashboard/diff.py::diff_loaded_maps`](../asmap_dashboard/diff.py); [`web/assets/js/utils/diffs.js::driftViews`](../web/assets/js/utils/diffs.js), [`web/assets/js/components/overview-cards.js::driftCard`](../web/assets/js/components/overview-cards.js).

### Cumulative drift since the oldest build (chart)

- **Question:** how far has the map moved from a fixed baseline?
- **Inputs:** for each build, the precomputed diff against the oldest build with an unfilled variant; coverage fields per category.
- **Calculation:** per build, the reassigned / newly mapped / unmapped address space (in the selected family) as a share of the pair's coverage union, plus a dashed total. Every point shares the same baseline, so the lines measure distance from one fixed map.
- **Output:** read from `metrics.json` `diffs[]` rows where `from` is the baseline build.
- **Example:** if the January 2024 baseline maps an address to AS174 and every later build maps it to AS3356, that address counts as reassigned in every point after the change.
- **Read as:** a flat stretch means the upstream data held steady; a steep climb means fast change.
- **Do not read as:** a sum of the per-release bars. An address that moves away and later moves back cancels out against the baseline but appears in two per-release bars.
- **Code:** [`asmap_dashboard/metrics.py::_compute_pair_diffs`](../asmap_dashboard/metrics.py); [`web/assets/js/components/drift-chart-points.js::cumulativePoints`](../web/assets/js/components/drift-chart-points.js).

### Drift between builds (chart)

- **Question:** how large was each individual release?
- **Inputs:** for each build, the diff against its most recent diffable predecessor; same category fields as above.
- **Calculation:** one stacked bar per release: reassigned, newly mapped, and unmapped address share against that pair's coverage union.
- **Output:** `metrics.json` `diffs[]` rows for adjacent diffable pairs.
- **Example:** the 2026-07-02 bar stacks 1.3 % reassigned + 0.25 % newly mapped + a small unmapped slice, matching the Drift vs previous card for the same pair in IPv4 mode.
- **Read as:** tall bar, large update. Each tooltip names the gap in days.
- **Do not read as:** time-normalised. A bar after a five-month publishing pause stacks five months of churn.
- **Code:** [`asmap_dashboard/diff.py::diff_loaded_maps`](../asmap_dashboard/diff.py); [`web/assets/js/components/drift-chart-points.js`](../web/assets/js/components/drift-chart-points.js) (step mode).

### Distinct operators per build (chart)

- **Question:** is the map seeing more operators over time?
- **Inputs:** `unique_asns` per build (unfilled variant).
- **Calculation:** the raw count per build, plus a "+N since <date>" delta against the oldest build with an unfilled variant.
- **Output:** `maps[].unfilled.unique_asns` over time.
- **Example:** 91,221 ASes in the 2026-06-04 build, 91,466 in 2026-07-02: the roster grew by 245 even though most drift was reassignment.
- **Read as:** more operators means an attacker must control more distinct networks to surround a node.
- **Do not read as:** drift. Reassigning space between operators already in the map leaves this flat.
- **Code:** [`asmap_dashboard/analyze.py::analyze_loaded_map`](../asmap_dashboard/analyze.py); [`web/assets/js/components/diversity-chart.js`](../web/assets/js/components/diversity-chart.js).

### Source data entries over time (chart)

- **Question:** how fast is the map's coverage growing, and how much does filling compress it?
- **Inputs:** `entries_count` and `file_size_bytes` of both variants per build.
- **Calculation:** two lines, unfilled and filled entry counts. The tooltip adds the on-disk size and the fill-compression ratio between the variants.
- **Output:** `maps[].{unfilled,filled}.entries_count`.
- **Example:** 466,771 unfilled vs 408,988 filled entries on 2026-07-02, a 1.14x compression.
- **Read as:** a rising unfilled line means upstream advertises more prefixes; the gap to filled is encoding, not data.
- **Do not read as:** address-space coverage. A /8 and a /24 both count as one entry; the drift charts weight by addresses instead.
- **Code:** [`asmap_dashboard/analyze.py::analyze_loaded_map`](../asmap_dashboard/analyze.py); [`web/assets/js/components/entries-chart.js`](../web/assets/js/components/entries-chart.js).

### Source data entries delta between builds (chart)

- **Question:** did a release add or lose coverage?
- **Inputs:** unfilled `entries_count` of each build and its most recent unfilled predecessor.
- **Calculation:** the signed difference, one bar per release. A build whose immediate predecessor is filled-only falls back to the last unfilled build rather than blanking the bar.
- **Output:** derived in the frontend from `maps[]`.
- **Example:** a -8,000 bar usually means pulled-back RPKI or IRR coverage, not an error.
- **Read as:** positive bars are coverage growth; negative bars are upstream withdrawals.
- **Do not read as:** drift direction. Entries can hold flat while large space is reassigned.
- **Code:** [`web/assets/js/components/map-delta-chart.js`](../web/assets/js/components/map-delta-chart.js).

## Network tab

Purpose: score the published build history against reachable Bitcoin nodes from the Bitnodes lineage. Reads `network.json`; the tab and its nav entry stay hidden when that file is absent. Surfaces: a caption naming the crawl and the build it is scored against, up to six snapshot cards, four trend charts under a range picker, one data-quality stat, and a Limitations note for concentration exclusions. Chart markers show the archive-to-bitnod.es handoff; every series remains one lineage.

Two shared rules first, because most metrics below inherit them:

- **In-effect build:** each snapshot is scored against the most recent build released at or before the crawl, widened by one day so a crawl pairs with its own same-day build ([`asmap_dashboard/network/metrics.py::_select_in_effect_build`](../asmap_dashboard/network/metrics.py)).
- **Effective address family:** an IPv6 address that transports an IPv4 host (6to4, Teredo, NAT64, v4-mapped) counts as IPv4, mirroring Bitcoin Core's `GetGroup()` ([`asmap_dashboard/netgroup.py::linked_ipv4`](../asmap_dashboard/netgroup.py)). Every per-snapshot metric also ships an `ipv4` / `ipv6` split under `families`.

Deliberate carve-outs (today: AS63949 `/Satoshi:27.0.0/` out of the whole Network-tab population) are catalogued in [network-exclusions.md](network-exclusions.md) and stated on the Network tab under Limitations. When nothing matches, the filter is a no-op.

### AS concentration (card)

- **Question:** how bunched are today's nodes across operators?
- **Inputs:** per-AS node counts of the latest snapshot under the in-effect build, after Network population exclusions ([network-exclusions.md](network-exclusions.md)); unmapped nodes excluded from the HHI itself.
- **Calculation:** Herfindahl-Hirschman index: each AS's share of mapped nodes, squared, summed. Equivalently the probability two random mapped nodes sit in the same AS. Range 0 to 1, lower is more diverse; 1/HHI is the effective number of equal-sized operators.
- **Output:** `sources.bitnodes.snapshots[].hhi` (and `families.*.hhi`); exclusion count in `snapshots[].network_exclusions`.
- **Example:** the 2026-07-23 snapshot scores 0.0299 overall, so two random nodes share an AS about 3 % of the time (roughly 33 equal-sized operators). IPv6 alone runs 0.075, noticeably more concentrated.
- **Read as:** the honest concentration headline; it keeps rising when share shifts from the top operator to the runner-up, which "largest operator's share" would miss.
- **Do not read as:** a statement about unmapped nodes; they are left out of HHI and counted in coverage instead. Also not a raw census including the AS63949 `/Satoshi:27.0.0/` fleet — that fleet is carved out of every Network-tab figure.
- **Code:** [`asmap_dashboard/network/metrics.py::_hhi`](../asmap_dashboard/network/metrics.py); [`web/assets/js/components/network/overview.js::concentrationCard`](../web/assets/js/components/network/overview.js).

### ASes to reach 50% (card)

- **Question:** how many operators would an attacker need to control to sit next to half the mapped nodes?
- **Inputs:** the same per-AS node counts as HHI (after Network population exclusions).
- **Calculation:** sort ASes by node count descending, add from the top until the running total reaches 50 % of mapped nodes in that distribution, report the count. `None` (rendered as a no-data state) when nothing is mapped.
- **Output:** `snapshots[].ases_to_50pct`.
- **Example:** 18 for the 2026-07-23 snapshot: the eighteen largest operators together host half of the 9,578 mapped nodes.
- **Read as:** higher is healthier. The 50 % cut matches what decentralisation studies use (the AS Nakamoto coefficient), so the count is comparable across projects.
- **Do not read as:** a claim that those operators cooperate or control the network. It is a headcount, and the blunt adversarial reading.
- **Code:** [`asmap_dashboard/network/metrics.py::_ases_to_reach_share`](../asmap_dashboard/network/metrics.py); [`web/assets/js/components/network/overview.js::reach50Card`](../web/assets/js/components/network/overview.js).

### Map staleness (card)

- **Question:** how wrong does a one-year-old map get for today's nodes?
- **Inputs:** the decay curve (next section), read at 365 days of map age.
- **Calculation:** linear interpolation between the two builds surrounding 365 days; if the history is one-sided, the nearest point scaled through the origin. The context line names the readings used.
- **Output:** derived in the frontend from `sources.bitnodes.decay.points`.
- **Example:** with 3.4 % drift at 320 days and 4.1 % at 410 days, the card interpolates about 3.75 % per year.
- **Read as:** the refresh-cadence argument in one number. A low rate means maps age gracefully; a high rate argues for shipping fresher asmaps.
- **Do not read as:** attribution error. The default reference is the newest map, not live routing; switch the curve to Reality for that.
- **Code:** [`web/assets/js/components/network/staleness-data.js::stalenessAtTarget`](../web/assets/js/components/network/staleness-data.js); curve from [`asmap_dashboard/network/metrics.py::_drift_curve`](../asmap_dashboard/network/metrics.py).

### Latest update impact (card)

- **Question:** how many real nodes did the most recent release move?
- **Inputs:** the latest snapshot's node set, looked up in the two newest diffable builds.
- **Calculation:** per node, classify the ASN transition as reassigned, newly mapped, or unmapped (the same classifier the prefix diff uses); headline is the total affected.
- **Output:** `sources.bitnodes.latest_update` (also mirrored at the top level for the Diff Explorer banner).
- **Example:** the 2026-07-02 release moved 107 of 9,587 observed nodes: 102 reassigned, 5 newly mapped, 0 unmapped.
- **Read as:** the map diff translated into peers. A tiny count is routing noise; a jump is worth opening in the Diff Explorer.
- **Do not read as:** visitor-relative. The node set is the latest crawl, so the figure ages with the data, not with when you look at it.
- **Code:** [`asmap_dashboard/network/metrics.py::_latest_update_impact`](../asmap_dashboard/network/metrics.py); [`web/assets/js/components/network/overview.js::latestUpdateCard`](../web/assets/js/components/network/overview.js).

### Reachable nodes (card)

- **Question:** how large is the population every other Network number rests on?
- **Inputs:** the latest snapshot after loading (onion / I2P / CJDNS peers already dropped) and after Network population exclusions ([network-exclusions.md](network-exclusions.md)).
- **Calculation:** count of remaining clearnet nodes, split by effective family.
- **Output:** `snapshots[].nodes_clearnet`, `families.*.nodes`; excluded count in `snapshots[].network_exclusions`.
- **Example:** about 8,630 scored clearnet nodes on 2026-07-23 after dropping ~956 AS63949 `/Satoshi:27.0.0/` hosts (raw crawl still ~9,587).
- **Read as:** the denominator context for the cards around it.
- **Do not read as:** the whole Bitcoin network, or the raw crawler clearnet count. Tor-only listeners, unreachable nodes, and the documented fleet exclusion are out of scope by construction.
- **Code:** [`asmap_dashboard/network/snapshots.py`](../asmap_dashboard/network/snapshots.py) (loaders); [`asmap_dashboard/network/metrics.py::_network_metric_nodes`](../asmap_dashboard/network/metrics.py); [`web/assets/js/components/network/overview.js::nodesCard`](../web/assets/js/components/network/overview.js).

### Peer diversity buckets (card)

- **Question:** how much does ASmap actually consolidate Core's peer buckets?
- **Inputs:** every clearnet node, bucketed twice: by ASmap lookup and by Core's default `GetGroup()` (/16 for IPv4, /32 for IPv6, /36 inside Hurricane Electric's tunnel range).
- **Calculation:** count distinct buckets under each scheme; unmapped nodes fall back to their default group inside the ASmap count, so the number stays honest. Report both counts and the reduction ratio.
- **Output:** `snapshots[].bucketing` (`asmap_groups`, `default_groups`, `reduction_ratio`).
- **Example:** 1,328 ASmap buckets vs 4,788 default buckets on 2026-07-23, a 3.6x reduction.
- **Read as:** the security gain: with ASmap an attacker needs whole operators, not adjacent IP ranges, to dominate a peer's buckets.
- **Do not read as:** fewer buckets being bad. The reduction is the point; the default scheme splits one operator across many /16s.
- **Code:** [`asmap_dashboard/network/metrics.py::_Tally.bucketing`](../asmap_dashboard/network/metrics.py), [`asmap_dashboard/netgroup.py::default_netgroup`](../asmap_dashboard/netgroup.py); [`web/assets/js/components/network/overview.js::bucketsCard`](../web/assets/js/components/network/overview.js).

### Map staleness for today's nodes (chart)

- **Question:** how does drift accumulate with map age, and against which truth?
- **Inputs:** the latest snapshot's node set, held fixed, looked up in every build at or older than it. Two references, switchable in the chart: "Newest map" (each node's target is its lookup under the freshest build) and "Reality" (the target is the node's Team Cymru ASN, available only when at least half the latest snapshot carries WHOIS).
- **Calculation:** per build, the share of kept nodes resolving to a different AS than their target. Nodes the reference build does not map are dropped, so the freshest point reads as the attribution gap rather than a coverage artefact. The x-axis runs from today into the past.
- **Output:** `sources.bitnodes.decay` and `decay_truth`.
- **Example:** the January 2024 build (909 days old) misplaces 9.8 % of today's nodes against the newest map, 13.8 % against live routing. In the Reality view the newest build itself sits at about 5.5 %, which is exactly 100 minus the attribution agreement below.
- **Read as:** the pure aging signal (Newest map) or the operational "when do I need a fresher map?" reading (Reality).
- **Do not read as:** historical truth. WHOIS reflects current routing only; the pipeline never applies today's ASNs to old snapshots, and Reality disappears rather than falling back to stale archive tags.
- **Code:** [`asmap_dashboard/network/metrics.py::_drift_curve`](../asmap_dashboard/network/metrics.py), `_map_target`, `_truth_target`, `_decay_window`; [`web/assets/js/components/network/trend-charts.js`](../web/assets/js/components/network/trend-charts.js).

### Top 5 operators per snapshot (chart)

- **Question:** who concentrates the nodes, and is the top tier losing grip?
- **Inputs:** `snapshots[].top_ases` (top 15 stored; the chart renders five), after Network population exclusions ([network-exclusions.md](network-exclusions.md)).
- **Calculation:** per snapshot, the five largest ASes by node share, re-picked each time so a rising operator is not understated; stacked bar height is the combined top-5 share.
- **Output:** `snapshots[].top_ases[]` (`asn`, `nodes`, `share`).
- **Example:** after excluding the AS63949 `/Satoshi:27.0.0/` fleet, the 2026-07-23 top tier is led by ordinary operators (e.g. Hetzner); remaining AS63949 share is non-fleet Linode peers only.
- **Read as:** a shrinking stack means nodes spreading across more operators. Colours are stable per operator, so a colour vanishing is the tier reshuffling.
- **Do not read as:** the whole distribution; HHI covers the long tail this chart cuts off. Also not a raw crawler census of every clearnet peer.
- **Code:** [`asmap_dashboard/network/metrics.py::_top_ases`](../asmap_dashboard/network/metrics.py); [`web/assets/js/components/network/operators-chart.js`](../web/assets/js/components/network/operators-chart.js).

### AS concentration over time (chart)

- **Question:** is the network diversifying or concentrating?
- **Inputs:** the HHI of every snapshot, each scored against its in-effect build; family toggle (All / IPv4 / IPv6).
- **Calculation:** same HHI as the card, one point per snapshot.
- **Output:** `snapshots[].hhi`, `families.*.hhi`.
- **Example:** IPv4 sets the overall level (majority of nodes); IPv6 runs two to three times more concentrated, which the All view alone hides.
- **Read as:** a falling line means spreading across more operators.
- **Do not read as:** an artifact-free series. The archive-to-live handoff marker matters: crawler reach affects who gets counted.
- **Code:** [`asmap_dashboard/network/metrics.py::_snapshot_metrics`](../asmap_dashboard/network/metrics.py); [`web/assets/js/components/network/trend-charts.js`](../web/assets/js/components/network/trend-charts.js).

### ASmap coverage of observed nodes (chart)

- **Question:** can the map place the nodes that actually exist?
- **Inputs:** per snapshot, `mapped` and `nodes_clearnet` under the in-effect build.
- **Calculation:** mapped divided by clearnet. The remainder falls outside every prefix the map carries and uses Core's default buckets.
- **Output:** `snapshots[].mapped` / `snapshots[].nodes_clearnet`.
- **Example:** 9,578 of 9,587 nodes mapped on 2026-07-23, or 99.9 %.
- **Read as:** a falling line means the routing data behind ASmap lags where new nodes appear; it can sag as a map ages and snap back at the next release.
- **Do not read as:** a quality ranking between snapshots from different crawl stages. There is no card for this metric because it idles near 99.9 %; the story is the trend.
- **Code:** [`asmap_dashboard/network/metrics.py::_Tally`](../asmap_dashboard/network/metrics.py); [`web/assets/js/components/network/trend-charts.js`](../web/assets/js/components/network/trend-charts.js).

### ASN attribution agreement (stat)

- **Question:** do the two independent attribution methods agree, meaning can the rest of the tab be trusted?
- **Inputs:** the latest snapshot's nodes that both Team Cymru and the in-effect ASmap could attribute. Shown only when at least half the clearnet nodes carry a WHOIS ASN.
- **Calculation:** agreements divided by compared nodes. The note reports provider, coverage, and the compared count so the figure is checkable.
- **Output:** `snapshots[].cross_check` plus `reality_attribution` metadata.
- **Example:** 9,038 of 9,560 compared nodes agree on 2026-07-23, or 94.5 %, with 99.8 % Team Cymru coverage.
- **Read as:** a data-quality signal. The ~5 % disagreement is mostly route aggregation differences and map age, and it reappears as the Reality curve's starting point.
- **Do not read as:** network health. Nothing about node distribution is in this number.
- **Code:** [`asmap_dashboard/network/metrics.py::_cross_check`](../asmap_dashboard/network/metrics.py); [`web/assets/js/components/network/cross-check.js`](../web/assets/js/components/network/cross-check.js).

## Diff Explorer tab

Purpose: pick any two builds (Map A, Map B) and inspect what changed. Reads the diff summary from `metrics.json`, lazy-loads the top-mover rosters from `diffs.json` on first open, and pulls per-pair node impact from `network.json` when present. An IPv4/IPv6 toggle scopes every surface below it. All diffs are unfilled vs unfilled; a pair missing an unfilled side shows an explicit "no precomputed diff" notice.

### Match banner

- **Question:** how similar are the two maps where Bitcoin Core's bucketing actually looks?
- **Inputs:** `ipv4_buckets_changed` / `ipv4_bucket_space_union` (IPv6: `ipv6_blocks_changed` / `ipv6_block_space_union`).
- **Calculation:** changed prefixes are merged into address ranges, then counted in default NetGroup buckets (/16 for IPv4, /32 for IPv6). A bucket counts as changed when any prefix inside it gained, lost, or swapped its ASN. Match = 1 minus changed over the union of both maps' buckets.
- **Output:** the four fields above per `diffs[]` row.
- **Example:** 2026-06-04 vs 2026-07-02: 5,347 of 52,424 IPv4 /16 buckets differ, an 89.8 % match.
- **Read as:** bucket vocabulary keeps the two families comparable despite 2^32 vs 2^128 of address space.
- **Do not read as:** address-weighted drift; one changed /24 flips its whole /16 bucket. The drift charts weight by addresses.
- **Code:** [`asmap_dashboard/diff.py::diff_loaded_maps`](../asmap_dashboard/diff.py), [`asmap_dashboard/_prefix.py::count_buckets`](../asmap_dashboard/_prefix.py); [`web/assets/js/components/diff-explorer/breakdown.js::matchBanner`](../web/assets/js/components/diff-explorer/breakdown.js).

### Change classification

- **Question:** what kind of change was this release?
- **Inputs:** per-family entry counts `reassigned_ipv4`, `newly_mapped_ipv4`, `unmapped_ipv4` (or the `_ipv6` fields).
- **Calculation:** every changed prefix falls into exactly one bucket: reassigned (both maps assign it, to different ASes), newly mapped (ASN 0 in A, real ASN in B), unmapped (real ASN in A, ASN 0 in B). The stacked bar shows the three as shares of the family total.
- **Output:** the per-family fields per `diffs[]` row.
- **Example:** 2026-06-04 vs 2026-07-02 on IPv4: 15,580 reassigned, 3,660 newly mapped, and a small unmapped remainder.
- **Read as:** reassigned is routine BGP / RPKI churn; a large unmapped slice means upstream withdrew coverage.
- **Do not read as:** address-space weight. These are entry counts; a /8 and a /48 weigh the same here.
- **Code:** [`asmap_dashboard/_prefix.py::classify_asn_change`](../asmap_dashboard/_prefix.py), [`asmap_dashboard/diff.py::_DiffBuckets`](../asmap_dashboard/diff.py); [`web/assets/js/components/diff-explorer/breakdown.js::classificationRow`](../web/assets/js/components/diff-explorer/breakdown.js).

### AS roster delta

- **Question:** did the set of known operators itself change?
- **Inputs:** `as_total_a`, `as_total_b`, `as_appeared`, `as_disappeared`.
- **Calculation:** set difference over each map's non-zero ASNs. Family toggle does not apply; the roster spans both families.
- **Output:** the four fields per `diffs[]` row.
- **Example:** 91,221 ASes in Map A, 91,466 in Map B: 731 appeared, 486 disappeared.
- **Read as:** roster churn, distinct from prefix churn. A prefix moving between two existing ASes changes the classification above but not this line.
- **Do not read as:** operators joining or leaving the internet; most roster churn is upstream data coverage.
- **Code:** [`asmap_dashboard/diff.py::diff_loaded_maps`](../asmap_dashboard/diff.py); [`web/assets/js/components/diff-explorer/breakdown.js::rosterDeltaRow`](../web/assets/js/components/diff-explorer/breakdown.js).

### Real node impact

- **Question:** how many observed Bitcoin nodes does this pair actually move?
- **Inputs:** `network.json` `pair_impact.pairs["<from>|<to>"]`, computed from the latest crawl's node set looked up in both builds; scoped to the selected family.
- **Calculation:** per node, the same three-way classification as the prefix diff; only aggregate counts are published, never addresses.
- **Output:** `pair_impact.pairs` per diffable pair, plus the `latest_update` banner variant for the two newest builds.
- **Example:** the January 2024 pair moves 160 of 9,587 nodes; the newest pair moves 107.
- **Read as:** the bridge between abstract prefix churn and peers affected. A pair can move gigantic address space and few nodes, or the reverse.
- **Do not read as:** available everywhere. A pair shows no line until the published network data covers both builds.
- **Code:** [`asmap_dashboard/network/metrics.py::_build_node_impact`](../asmap_dashboard/network/metrics.py); [`web/assets/js/components/diff-explorer/node-impact.js`](../web/assets/js/components/diff-explorer/node-impact.js).

### Top movers

- **Question:** which operators drove the diff?
- **Inputs:** the pair's roster in `diffs.json`, keyed `"<from>|<to>"`. Each row carries per-family gained / lost address counts, the primary counterpart AS, and the operator's footprint in each map.
- **Calculation:** per AS, gained plus lost address space in the active family; the roster is the union of the top 50 per family, so a table-visible AS is always reachable. Share is the row's changed space over the total moved in that family. Direction and counterpart come from the larger flow direction, so the arrow points at the real source or destination, never at ASN 0.
- **Output:** `top_movers["<from>|<to>"][]` in `diffs.json`.
- **Example:** in the January 2024 pair, AS21502 gained 11,261,696 IPv4 addresses, mostly from AS198949, having held none in Map A.
- **Read as:** hover a row for the raw counts and Touched, the share of the operator's own footprint this change moved.
- **Do not read as:** exhaustive. The long tail of one-or-two-change ASes is cut at 50 per family; Touched can read above 100 % when one build stores the operator as a single block and the other splits it.
- **Code:** [`asmap_dashboard/diff.py::_PerAsActivity`](../asmap_dashboard/diff.py) (ranking, rows, `_primary_counterpart`); [`web/assets/js/components/top-movers-table.js`](../web/assets/js/components/top-movers-table.js) and `web/assets/js/components/top-movers/`.

## Reading metrics together

- **Coverage, HHI, ASes to 50 %, top 5.** Coverage asks how many nodes get mapped at all; the other three ask how the mapped ones distribute. HHI weighs the whole distribution, ASes-to-50 % is its adversarial headcount, top 5 names the operators. They move together; quoting all four as separate findings double-counts one fact.
- **Match banner, top movers, node impact.** Three granularities of one pair: buckets (how similar), operators (who moved), peers (who is affected). A high match with large node impact means the change concentrated exactly where nodes sit.
- **Decay curve, staleness card, latest update.** The curve is the function, the card is its value at 365 days, latest update is the step the newest release added. Quote the card for cadence arguments and the curve for shape.
- **Entries and entries delta vs drift.** Entries measure coverage growth, drift measures reassignment. A flat entries line with high drift is a map being reshuffled, not grown.

## Limitations

- **Clearnet only.** Tor, I2P, and CJDNS peers carry no IP for ASmap to resolve and are excluded from every Network number.
- **One crawler.** The node population is whatever the Bitnodes lineage reaches. Absolute counts partly reflect crawler reach, which is also why no raw unique-AS chart exists on the Network tab.
- **WHOIS covers only the newest snapshot.** Historical Reality curves are impossible with current BGP data, so the pipeline refuses to fake them. Below 50 % Team Cymru coverage, Reality and the cross-check hide and the Pages deploy keeps the previous site.
- **Lineage handoff and gaps.** The archive-to-bitnod.es handoff is marked, not hidden. Release assets for 2026-06-22 through 2026-06-25 were never archived; the June 26 file's newest embedded date is June 25, so the series has no measurements for June 22 to 24 or June 26.
- **Daily, not realtime.** Payloads refresh on a nightly cron; maps and diffs rebuild only when their inputs change.
- **Missing unfilled variants.** The 2025-03-21 build published no unfilled file, so diffs and drift charts show a gap there by design.
- **IPv6 magnitudes.** IPv6 coverage counts exceed 2^53 and round in JSON consumers at ~1e-16 relative error; everything is quantised to /32 blocks before display, so this never changes a rendered number.
- **No raw IPs in public payloads.** The WHOIS cache under `cache/whois/` is private by construction; only aggregates ship.
