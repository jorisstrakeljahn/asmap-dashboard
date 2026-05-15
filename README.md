# asmap-dashboard

Dashboard for exploring ASmap binary files used by Bitcoin Core for peer diversity.

Live: <https://jorisstrakeljahn.github.io/asmap-dashboard/>

## How it works

A Python pipeline (`asmap_dashboard/`) reads every published `.dat` file in [bitcoin-core/asmap-data](https://github.com/bitcoin-core/asmap-data), profiles each build, diffs every distinct pair, and emits a single `metrics.json`. The static site under `web/` consumes that payload: overview cards, time-series charts, and a diff explorer with match-rate banner, change classification, and top-movers table.

A GitHub Actions workflow regenerates `metrics.json` daily; a separate workflow deploys `web/` to GitHub Pages on push.

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

Requires Python 3.10+. The runtime uses only the standard library; tests need `pytest`.

```
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
```

## Regenerate dashboard data

```
git clone https://github.com/bitcoin-core/asmap-data.git
python -m asmap_dashboard metrics --data-dir asmap-data --out web/assets/data/metrics.json
python -m asmap_dashboard refresh-asn-names --metrics web/assets/data/metrics.json --out web/assets/data/asn-names.json
```

The first command builds the full metrics payload from a checkout of asmap-data. The second pulls operator labels (`AS7018 (AT&T Services, Inc.)`) from [bgp.tools/asns.csv](https://bgp.tools/asns.csv) and filters them down to the ASNs actually used. Both commands also run daily in CI. The ASN-names step is non-fatal. If bgp.tools is unreachable the previous file is kept and the dashboard falls back to bare `AS<num>` labels.

## Run the dashboard

The frontend is plain HTML + ES modules. Any static file server works:

```
cd web
python3 -m http.server 8000
```

Open <http://localhost:8000>. `metrics.json` is committed, so a fresh clone works without running the pipeline first.

## Other commands

Profile a single map, or diff two of them directly:

```
python -m asmap_dashboard analyze /path/to/asmap.dat
python -m asmap_dashboard diff /path/to/old.dat /path/to/new.dat
```

Pass `--addrs nodes.txt` (one IP per line) to `diff` to also report how many of those nodes resolve to a different ASN under the new map.

## Tests

```
python -m pytest tests
```
