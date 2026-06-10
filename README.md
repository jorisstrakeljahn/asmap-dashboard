# asmap-dashboard

Dashboard for exploring ASmap binary files used by Bitcoin Core for peer diversity.

Live: <https://jorisstrakeljahn.github.io/asmap-dashboard/>

## How it works

A Python pipeline (`asmap_dashboard/`) reads every published `.dat` file in [bitcoin-core/asmap-data](https://github.com/bitcoin-core/asmap-data), profiles each build, diffs every distinct pair, and emits the dashboard payloads. The static site under `web/` consumes them: overview cards, time-series charts, a network tab scoring observed Bitcoin nodes against the build history, and a diff explorer with match-rate banner, change classification, and top-movers table.

The data layer is split into three files along size and reproducibility lines:

- `metrics.json` (~20 KB): per-build profiles. Loaded first, drives the overview and most charts.
- `diffs.json` (~10 MB): the all-pairs diff matrix. Fetched in parallel and rendered late, so the first paint never waits on it.
- `network.json` (~30 KB, optional): observed-node metrics derived from KIT crawler dossiers (and the archived Bitnodes snapshots). When the file is absent the Network tab stays hidden.

`metrics.json`, `diffs.json`, and `asn-names.json` are generated artefacts and are not tracked in git. The Pages workflow rebuilds them from scratch on every deploy and a daily cron picks up new asmap-data builds. `network.json` is the one exception: the KIT dossiers behind it are not public yet, so the small aggregate file is committed and deployed as-is until the raw data can be published.

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

The first command builds `metrics.json` plus `diffs.json` next to it (override with `--diffs-out`). The second pulls operator labels (`AS7018 (AT&T Services, Inc.)`) from [bgp.tools/asns.csv](https://bgp.tools/asns.csv) and filters them down to the ASNs the payloads actually reference. Missing payload files are skipped with a warning. The ASN-names step is non-fatal: if bgp.tools is unreachable the dashboard falls back to bare `AS<num>` labels. The same two commands run on every Pages deploy and daily via cron.

To regenerate the network section (requires the non-public KIT dossiers and/or the archived Bitnodes snapshots locally), add the snapshot directories. `network.json` is written next to `--out`:

```
python -m asmap_dashboard metrics --data-dir asmap-data \
    --kit-dir /path/to/kit-dossiers --bitnodes-dir /path/to/bitnodes \
    --out web/assets/data/metrics.json
```

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

JavaScript (static `web/` assets, Node is only needed for the linter, not for running the dashboard):

```
npm ci
npm run lint
```
