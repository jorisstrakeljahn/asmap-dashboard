"""Pin the JSON data contract between the pipeline and the frontend.

The Python pipeline and the JS frontend share a payload schema that
exists only as a hand-mirrored convention: a version constant duplicated
in both languages, and field names typed out literally on each side. The
frontend's accessors mask missing fields with ``?? 0``, so a renamed
Python field without a matching JS edit renders silent zeros instead of
crashing — a failure the project has already hit once. These tests turn
that convention into something CI enforces: they fail on any drift
between the two sides, which is the whole point. On a legitimate schema
change, update the JS accessors, bump both version constants, and the
tests pass again.
"""

from __future__ import annotations

import ipaddress
import re
from pathlib import Path

from asmap_dashboard.diff import diff_loaded_maps
from asmap_dashboard.loader import load_map
from asmap_dashboard.metrics import SCHEMA_VERSION

from .conftest import write_asmap

_REPO_ROOT = Path(__file__).resolve().parents[1]
_APP_JS = _REPO_ROOT / "web/assets/js/app.js"
_UNITS_JS = _REPO_ROOT / "web/assets/js/components/top-movers/units.js"
_DRIFT_POINTS_JS = _REPO_ROOT / "web/assets/js/components/drift-chart-points.js"


def test_schema_version_constants_match():
    """The Python SCHEMA_VERSION and the JS EXPECTED_SCHEMA_VERSION are
    the gate that stops a stale cached frontend from rendering nonsense
    against a fresh payload. This test forces the two to be bumped
    together: if they drift, a renamed field would otherwise render
    silently wrong instead of being refused.
    """
    text = _APP_JS.read_text()
    match = re.search(r"EXPECTED_SCHEMA_VERSION\s*=\s*(\d+)", text)
    assert match, "EXPECTED_SCHEMA_VERSION not found in app.js"
    assert int(match.group(1)) == SCHEMA_VERSION


def _build_two_family_diff(tmp):
    """A diff over a fixture touching both address families, so every
    per-family field the frontend reads is actually populated."""
    a = write_asmap(
        tmp / "a.dat",
        [
            (ipaddress.IPv4Network("1.0.0.0/8"), 100),
            (ipaddress.IPv4Network("16.0.0.0/8"), 100),
            (ipaddress.IPv6Network("2001:db8::/32"), 200),
            (ipaddress.IPv6Network("2a00::/16"), 200),
        ],
    )
    b = write_asmap(
        tmp / "b.dat",
        [
            (ipaddress.IPv4Network("1.0.0.0/8"), 999),
            (ipaddress.IPv4Network("16.0.0.0/8"), 100),
            (ipaddress.IPv6Network("2001:db8::/32"), 777),
            (ipaddress.IPv6Network("2a00::/16"), 200),
        ],
    )
    return diff_loaded_maps(load_map(a), load_map(b))


def test_pair_diff_carries_fields_frontend_reads(tmp_path):
    """Every diff-level field the drift chart binds must exist as a key
    of the generated pair-diff dict."""
    diff = _build_two_family_diff(tmp_path)

    block = re.search(
        r"const UNIT_FIELDS\s*=\s*\{(.*?)\n\};",
        _DRIFT_POINTS_JS.read_text(),
        re.DOTALL,
    )
    assert block, "UNIT_FIELDS table not found in drift-chart-points.js"
    diff_fields = set(re.findall(r'"([a-z0-9_]+)"', block.group(1)))
    assert diff_fields, "no quoted field names parsed from UNIT_FIELDS"

    missing = sorted(f for f in diff_fields if f not in diff)
    assert not missing, f"pipeline diff dict missing fields the chart reads: {missing}"


def test_top_movers_rows_carry_fields_frontend_reads(tmp_path):
    """Every row-level field the Top Movers table binds must exist on at
    least one generated top_movers row."""
    diff = _build_two_family_diff(tmp_path)
    rows = diff["top_movers"]
    assert rows, "fixture produced no top_movers rows"

    row_fields = set(re.findall(r"row\.([a-z0-9_]+)", _UNITS_JS.read_text()))
    assert row_fields, "no row.<field> accessors parsed from units.js"

    keys = set().union(*(row.keys() for row in rows))
    missing = sorted(f for f in row_fields if f not in keys)
    assert not missing, f"top_movers rows missing fields the table reads: {missing}"
