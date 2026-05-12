# asmap-dashboard

Dashboard for exploring ASmap binary files used by Bitcoin Core for peer diversity.

Live: <https://jorisstrakeljahn.github.io/asmap-dashboard/>

## How it works

A Python pipeline (`asmap_dashboard/`) reads every `.dat` file in [bitcoin-core/asmap-data](https://github.com/bitcoin-core/asmap-data), profiles each build, diffs every distinct pair, and emits a single `metrics.json`. The static site under `web/` consumes that payload: overview cards, time-series charts, and a diff explorer with match-rate banner, change classification, and top-movers table.

A GitHub Actions workflow regenerates `metrics.json` daily; a separate workflow deploys `web/` to GitHub Pages on push.

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

The first command builds the full metrics payload from a checkout of asmap-data. The second pulls operator labels (`AS7018 (AT&T Services, Inc.)`) from [bgp.tools/asns.csv](https://bgp.tools/asns.csv) and filters them down to the ASNs actually used. Both commands also run daily in CI; the ASN-names step is non-fatal — if bgp.tools is unreachable the previous file is kept and the dashboard falls back to bare `AS<num>` labels.

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
