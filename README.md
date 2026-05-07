# asmap-dashboard

Dashboard for exploring ASmap binary files used by Bitcoin Core for peer diversity.

## What it does

Two parts that talk to each other through a single JSON payload.

The Python package `asmap_dashboard` reads the `.dat` files published in [bitcoin-core/asmap-data](https://github.com/bitcoin-core/asmap-data), profiles each build, diffs every pair of distinct maps, and emits a `metrics.json` payload describing the entire history.

The static site under `web/` consumes `metrics.json` and renders the Maps tab: per-build overview cards, file-size and entry-count delta charts over the published history, and a diff explorer with match-rate banner, change classification, and top-mover table for any pair of distinct builds.

## Requirements

Python 3.10 or later. The runtime uses only the standard library; the test suite needs `pytest`.

```
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
```

## Running the analysis

Profile a single map:

```
python -m asmap_dashboard analyze /path/to/asmap.dat
```

Diff two maps. Pass `--addrs` with a text file of one IP per line to also report how many of those nodes would resolve to a different ASN under the new map:

```
python -m asmap_dashboard diff /path/to/old.dat /path/to/new.dat
python -m asmap_dashboard diff /path/to/old.dat /path/to/new.dat --addrs nodes.txt
```

Generate the full dashboard payload over a checkout of asmap-data:

```
git clone https://github.com/bitcoin-core/asmap-data.git
python -m asmap_dashboard metrics --data-dir asmap-data --out web/assets/data/metrics.json
```

## Running the dashboard

The frontend is plain HTML, CSS, and ES modules, so any static file server will do. The standard library's built-in server is enough:

```
cd web
python3 -m http.server 8000
```

Open <http://localhost:8000> in a browser. The page reads `web/assets/data/metrics.json`, which is committed to the repo, so the dashboard works on a fresh clone without running the analysis pipeline first.

## Testing

```
python -m pytest tests
```
