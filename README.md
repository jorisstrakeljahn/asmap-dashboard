# asmap-dashboard

Dashboard for exploring the ASmap binary files Bitcoin Core uses for peer diversity.

Live: <https://jorisstrakeljahn.github.io/asmap-dashboard/>

A stdlib-only Python pipeline (`asmap_dashboard/`) profiles every build in [bitcoin-core/asmap-data](https://github.com/bitcoin-core/asmap-data), diffs every pair, and scores observed Bitcoin nodes against the build history. The static site under `web/` renders three tabs from the generated payloads: Maps (per-build profiles and history charts), Network (observed nodes scored against the maps), and a Diff Explorer.

Documentation:

- [`docs/metrics.md`](docs/metrics.md) - what each number means: data sources with samples, per-metric inputs, calculation, caveats, and code pointers.
- [`docs/architecture.md`](docs/architecture.md) - data flow, module map, URL structure, and design decisions.
- [`docs/network-exclusions.md`](docs/network-exclusions.md) - deliberate Network-tab population carve-outs (e.g. AS63949 `/Satoshi:27.0.0/`) with BNOC links.

## Setup

Requires Python 3.10+. The runtime uses only the standard library; the dev extras (`pytest`, `ruff`) come from [`pyproject.toml`](pyproject.toml).

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

The first command writes `metrics.json` plus `diffs.json` next to it (override with `--diffs-out`). The second pulls operator labels from [bgp.tools/asns.csv](https://bgp.tools/asns.csv), scoped to the ASNs the payloads reference.

For the optional Network tab, download the public node snapshots from the [`network-snapshots` release](https://github.com/jorisstrakeljahn/asmap-dashboard/releases/tag/network-snapshots) and run the `network` command (Team Cymru WHOIS needs a private cache path; see [`docs/metrics.md`](docs/metrics.md#team-cymru-ip-to-asn) for what it stores and why it stays local):

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

During development, replace `--whois-team-cymru` with `--whois-fixture /path/to/whois-fixture.json` to use a local fixture instead of the live service.

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

## Developing and CI

Generated payloads (`web/assets/data/*.json`) and the WHOIS cache (`cache/whois/`) are not committed. The cache holds raw node IPs; only aggregate counts ship in `network.json`. Point `--bitnodes-dir` at a Bitnodes-only tree (archived JSON and/or bitnod.es CSVs). Extra folders with other snapshot formats produce skip warnings and are not used.

Use `python -m asmap_dashboard metrics` when map profiles or prefix diffs change. Use `python -m asmap_dashboard network` for the daily node score; it skips the expensive all-pairs prefix-diff pass. Run `refresh-asn-names` after either so labels stay in sync. For offline Network work, replace `--whois-team-cymru` with `--whois-fixture`.

GitHub Actions (`.github/workflows/pages.yml`) runs on push to `main`, nightly, and `workflow_dispatch`. It gates deploy on ruff, pytest, and `npm test`. `metrics.json` / `diffs.json` are cached by asmap-data revision, schema, and map-analysis code; `network.json` rebuilds every run with Team Cymru and a private WHOIS cache. Below 50% Team Cymru coverage the smoke check fails and the previous site stays up. `.github/workflows/fetch-bitmex.yml` appends missing bitnod.es CSVs to the [`network-snapshots` release](https://github.com/jorisstrakeljahn/asmap-dashboard/releases/tag/network-snapshots) before the nightly Pages cron.
