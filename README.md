# asmap-dashboard

Dashboard for exploring ASmap binary files used by Bitcoin Core for peer diversity.

Live: <https://jorisstrakeljahn.github.io/asmap-dashboard/>

## How it works

A Python pipeline (`asmap_dashboard/`) reads every published `.dat` file in [bitcoin-core/asmap-data](https://github.com/bitcoin-core/asmap-data), profiles each build, diffs every distinct pair, and emits the dashboard payloads. The static site under `web/` consumes them: overview cards, time-series charts, a network tab scoring observed Bitcoin nodes against the build history, and a diff explorer with match-rate banner, change classification, and top-movers table.

See [`docs/architecture.md`](docs/architecture.md) for the architecture overview: data flow, module layout, URL structure, design decisions, and the network-metric glossary.

The data layer is split into three files along size and reproducibility lines:

- `metrics.json` (~110 KB): per-build profiles plus the all-pairs diff *summary* (every pair's aggregate fields, no top-mover roster). Loaded first; drives the overview, every drift chart, and the Diff Explorer's match banner.
- `diffs.json` (~4 MB): the per-pair top-mover rosters keyed by `"<from>|<to>"` - ~99 % of the diff bytes, read only by the Top Movers table. The frontend fetches it lazily the first time the Diff Explorer tab is opened, so the first paint never downloads or parses it.
- `network.json` (optional): observed-node metrics scoring real Bitcoin nodes against the build history. When the file is absent the Network tab stays hidden. Alongside the per-snapshot series it carries node-impact aggregates: `latest_update` (how many observed nodes change AS between the two most recent builds) and `pair_impact` (the same count for every diffable build pair, so the Diff Explorer can show a per-pair banner). `pair_impact` scales with the pair count, so the file grows with the build history; only aggregate counts are emitted, never node addresses.

All four payloads (`metrics.json`, `diffs.json`, `network.json`, `asn-names.json`) are generated artefacts and are not tracked in git. The Pages workflow caches `metrics.json` and `diffs.json` by asmap-data revision, schema, and analysis code. `network.json` is rebuilt daily without running the prefix-diff pass.

The observed-node data behind `network.json` is fully public. Assets on the [`network-snapshots` release](../../releases/tag/network-snapshots) contain archived bitnodes.io crawls plus one gzipped [bitnod.es](https://bitnod.es) (BitMEX Research) CSV per day, appended by the `fetch-bitmex` workflow each night. They are one crawler lineage and therefore one `bitnodes` source in the payload and UI. The dashboard marks the archive-to-daily-export handoff instead of presenting it as a second crawler. Release assets named 2026-06-22 through 2026-06-25 were never archived and are no longer available from bitnod.es. The June 26 file contains June 25 as its newest embedded export date, so the plotted series has no measurements for June 22 through June 24 or June 26.

The CSV has no ASN column. The daily build sends the newest snapshot's clearnet IPs to [Team Cymru's IP-to-ASN service](https://www.team-cymru.com/ip-asn-mapping) and compares the returned BGP origin ASN with the ASmap lookup. It does not use Team Cymru's country field as geolocation. A 24-hour local cache stores successful lookups and temporary misses under `cache/whois/`; stale entries are refreshed. These files contain raw node IPs and are gitignored. GitHub Actions keeps them outside the Pages artifact, and only aggregate counts enter `network.json`.

Every payload carries a `schema_version` that the frontend checks before rendering, so a stale cached `app.js` paired with a freshly deployed payload (GitHub Pages caches assets for ~10 minutes) produces an explicit "please reload" message instead of silently wrong numbers.

### Filled vs unfilled inputs

Each build in asmap-data publishes up to two binary variants:

- **Unfilled** (`<timestamp>_asmap_unfilled.dat`) is the raw upstream prefix data the build was produced from (RPKI / IRR / Routeviews). It is the canonical source of truth. Filled can be derived from unfilled deterministically. The reverse is not possible.
- **Filled** (`<timestamp>_asmap.dat`) is the same data with `asmap-tool encode --fill` applied so adjacent same-AS prefixes collapse into a smaller binary. It is the form Bitcoin Core embeds.

The dashboard prefers unfilled almost everywhere because filled-vs-filled comparisons conflate real BGP / RPKI / IRR shifts with the rebalancing the fill heuristic does whenever adjacent same-AS prefixes appear or disappear. Concretely:

- Overview cards (entries, unique ASes, IPv4 / IPv6 split) read the unfilled profile, falling back to filled when a build did not publish unfilled. The fallback is annotated with a small badge.
- Pair diffs (drift chart, diff explorer, top movers, entries-delta chart) are computed unfilled-vs-unfilled. Pairs missing the unfilled variant on either side are skipped silently rather than rendered as misleading numbers.
- The map size chart shows both lines side-by-side: filled answers "what does Bitcoin Core embed?", unfilled answers "how much source data backed it?", and the tooltip reports the fill-compression ratio between them.

Builds that only published one variant remain visible in the build picker. Cards on those builds either show the available side (with the fallback badge) or report "not published" for the missing side, depending on which surface is reading the data.

## Setup

Requires Python 3.10+. The runtime uses only the standard library; the dev extras (`pytest`, `ruff`) are pulled in from `pyproject.toml`.

```
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

## Generate dashboard data

A fresh clone is missing the generated payloads, so run the pipeline once before serving the site:

```
git clone https://github.com/bitcoin-core/asmap-data.git
python -m asmap_dashboard metrics --data-dir asmap-data --out web/assets/data/metrics.json
python -m asmap_dashboard refresh-asn-names \
    --payload web/assets/data/metrics.json web/assets/data/diffs.json web/assets/data/network.json \
    --out web/assets/data/asn-names.json
```

The first command builds `metrics.json` (maps + diff summary) plus `diffs.json` next to it (the top-mover rosters; override with `--diffs-out`). The Pages workflow reuses those files until the asmap-data revision, schema, or map-analysis code changes. The second command pulls operator labels (`AS7018 (AT&T Services, Inc.)`) from [bgp.tools/asns.csv](https://bgp.tools/asns.csv) and filters them down to the ASNs the payloads reference.

To regenerate the network section, add the snapshot directories. The public snapshots come from the `network-snapshots` release (gunzip the CSVs; the loader reads plain `.json`/`.csv`):

```
gh release download network-snapshots --dir snapshots-dl
mkdir -p snapshots/live
tar -xzf snapshots-dl/bitnodes-asmap.tar.gz -C snapshots
for f in snapshots-dl/bitcoin_nodes_*.csv.gz; do gunzip -c "$f" > "snapshots/live/$(basename "$f" .gz)"; done
python -m asmap_dashboard network --data-dir asmap-data \
    --bitnodes-dir snapshots \
    --whois-cache cache/whois/records.json \
    --whois-team-cymru \
    --out web/assets/data/network.json
python -m asmap_dashboard refresh-asn-names \
    --payload web/assets/data/metrics.json web/assets/data/diffs.json web/assets/data/network.json \
    --out web/assets/data/asn-names.json
```

The Bitnodes directory can mix archived bitnodes.io JSON crawls and bitnod.es CSV exports. The loader dispatches on file extension, recurses into subfolders, and emits one continuous source. Each CSV is a cumulative "last seen" dump, so only rows within about two days of the file's newest `export_date` are kept. WHOIS is applied only to the newest snapshot because current BGP data cannot reconstruct historical routing.

For fixture-backed attribution during development, replace `--whois-team-cymru` with a local fixture:

```
python -m asmap_dashboard network --data-dir asmap-data \
    --bitnodes-dir snapshots \
    --whois-cache cache/whois/records.json \
    --whois-fixture /path/to/whois-fixture.json \
    --out web/assets/data/network.json
```

The CLI omits Reality and the ASN cross-check without sufficient current coverage. The Pages workflow also requires at least 50 percent Team Cymru coverage, so a provider outage stops that deployment and leaves the previous site online. The pipeline never substitutes an ASmap lookup or stale archive attribution.

## Run the dashboard

The frontend is plain HTML + ES modules. Any static file server works:

```
cd web
python3 -m http.server 8000
```

Open <http://localhost:8000>.

## Other commands

Profile a single map, or diff two of them directly:

```
python -m asmap_dashboard analyze /path/to/asmap.dat
python -m asmap_dashboard diff /path/to/old.dat /path/to/new.dat
```

Pass `--addrs nodes.txt` (one IP per line) to `diff` to also report how many of those nodes resolve to a different ASN under the new map.

## Tests and lint

Python (runtime + analysis pipeline):

```
python -m pytest tests
python -m ruff check
python -m ruff format --check
```

JavaScript (static `web/` assets; Node is only needed for the lint and test tooling, not for running the dashboard):

```
npm ci
npm run lint
npm test
```

`npm test` runs Node's built-in test runner over the pure frontend logic (see [`web/tests/`](web/tests/README.md)); no extra dependencies, no jsdom.
