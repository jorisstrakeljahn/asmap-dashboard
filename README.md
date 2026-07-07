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

All four payloads (`metrics.json`, `diffs.json`, `network.json`, `asn-names.json`) are generated artefacts and are not tracked in git. The Pages workflow rebuilds them from scratch on every deploy and a daily cron picks up new asmap-data builds and node snapshots.

The observed-node data behind `network.json` is split along data-access lines:

- **Public snapshots** live as assets on the [`network-snapshots` release](../../releases/tag/network-snapshots): the archived bitnodes.io crawls (collected by b10c) plus one gzipped [bitnod.es](https://bitnod.es) (BitMEX Research) CSV per day, appended by the `fetch-bitmex` workflow each night. They are release assets rather than committed files because the CSVs are ~5 MB/day raw and would bloat every clone. CI downloads them on each deploy and regenerates the `bitnodes` and `bitmex` series from scratch. At ~1 MB/day gzipped the release grows ~365 assets/year; if the nightly download or parse ever gets slow, thin the old dailies to a weekly cadence with `gh release delete-asset` - the charts lose nothing meaningful at that distance.
- **The KIT series** is derived from KIT DSN crawler dossiers that are not public, so CI cannot rebuild it. The small aggregate `data/network-kit.json` is committed instead and grafted into the CI-generated payload at deploy time (`merge-network`; base keys win, extra sources are added). After any change to the network pipeline (`asmap_dashboard/network/`), regenerate it locally from the KIT dossiers and commit it in the same change, or the frozen aggregate drifts from the code that produces it. The output is byte-stable, so a no-op regeneration produces no diff.

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

The first command builds `metrics.json` (maps + diff summary) plus `diffs.json` next to it (the top-mover rosters; override with `--diffs-out`). The second pulls operator labels (`AS7018 (AT&T Services, Inc.)`) from [bgp.tools/asns.csv](https://bgp.tools/asns.csv) and filters them down to the ASNs the payloads actually reference. Missing payload files are skipped with a warning. The ASN-names step is non-fatal: if bgp.tools is unreachable the dashboard falls back to bare `AS<num>` labels. The same two commands run on every Pages deploy and daily via cron.

To regenerate the network section, add the snapshot directories. The public snapshots come from the `network-snapshots` release (gunzip the CSVs; the loader reads plain `.json`/`.csv`):

```
gh release download network-snapshots --dir snapshots-dl
mkdir -p snapshots/bitmex
tar -xzf snapshots-dl/bitnodes-asmap.tar.gz -C snapshots
for f in snapshots-dl/bitcoin_nodes_*.csv.gz; do gunzip -c "$f" > "snapshots/bitmex/$(basename "$f" .gz)"; done
python -m asmap_dashboard metrics --data-dir asmap-data \
    --bitnodes-dir snapshots \
    --out web/assets/data/metrics.json
```

The Bitnodes directory can mix b10c JSON crawls and bitnod.es (BitMEX) CSV exports: the loader dispatches on file extension and recurses into subfolders. Each CSV is a cumulative "last seen" dump, so only rows within ~2 days of the file's newest `export_date` are kept, recovering a point-in-time set comparable to one JSON crawl.

With access to the non-public KIT dossiers, add `--kit-dir /path/to/kit-dossiers` and refresh the committed KIT graft from the result:

```
python - <<'EOF'
import json
d = json.load(open("web/assets/data/network.json"))
kit = {"schema_version": d["schema_version"], "network": {
    "reference_timestamp": d["network"]["reference_timestamp"],
    "sources": {"kit": d["network"]["sources"]["kit"]}}}
open("data/network-kit.json", "w").write(
    json.dumps(kit, separators=(",", ":"), sort_keys=True) + "\n")
EOF
```

CI merges `data/network-kit.json` into the freshly generated payload on every deploy (`python -m asmap_dashboard merge-network --base ... --extra ... --out ...`).

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
