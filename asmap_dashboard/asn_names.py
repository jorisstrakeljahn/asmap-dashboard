"""Refresh the frontend ASN \u2192 operator-name lookup table.

The dashboard renders top-mover rows as ``AS<num> (Operator)`` when a
human-readable name is available. The labels are sourced from
bgp.tools' canonical asns.csv dump, filtered down to the ASNs that
actually appear in metrics.json so the JSON we ship to the frontend
stays compact (a few kilobytes instead of the full 5 MB dump).

This module is intentionally a build-time utility, not part of the
analysis pipeline: analyze, diff, and metrics never touch it, and
``metrics.json`` remains the single source of truth for diff numbers.
A stale or missing ``asn-names.json`` only downgrades label
rendering to bare ``AS<num>``, which the frontend already handles.
"""

from __future__ import annotations

import csv
import io
import json
import urllib.request
from pathlib import Path
from typing import Dict, Iterable, Set, Union

PathLike = Union[str, Path]

BGP_TOOLS_URL = "https://bgp.tools/asns.csv"
# bgp.tools rejects requests without a descriptive User-Agent. Keep the
# string identifying the project so an operator triaging their logs can
# trace traffic back to this dashboard.
USER_AGENT = (
    "asmap-dashboard refresh-asn-names "
    "(+https://github.com/jorisstrakeljahn/asmap-dashboard)"
)


def extract_asns(metrics: dict) -> Set[int]:
    """Return every ASN referenced in the diffs of a metrics payload.

    Walks ``top_movers[*].asn`` plus ``primary_counterpart`` for every
    diff. ASN 0 is a sentinel for "unmapped" and is dropped so it
    never asks bgp.tools for a name that does not exist.
    """
    wanted: Set[int] = set()
    for diff in metrics.get("diffs", []):
        for row in diff.get("top_movers", []):
            for key in ("asn", "primary_counterpart"):
                value = row.get(key)
                if value:
                    wanted.add(int(value))
    return wanted


def parse_csv(body: str) -> Dict[int, str]:
    """Parse a bgp.tools-style CSV (asn,name,...) into {asn: name}.

    Tolerates two ASN formats: bgp.tools prefixes every value with
    ``AS`` (``AS174``), while other dumps (and the older bgp.tools
    schema) use the bare integer (``174``). Both are accepted so a
    different mirror or a fallback source can be plugged in without
    touching this code. Extra columns are ignored; rows missing a
    numeric asn or a non-empty name are skipped rather than crashing
    the whole refresh.
    """
    reader = csv.DictReader(io.StringIO(body))
    out: Dict[int, str] = {}
    for row in reader:
        asn = (row.get("asn") or "").strip().upper()
        if asn.startswith("AS"):
            asn = asn[2:]
        name = (row.get("name") or "").strip()
        if not asn.isdigit() or not name:
            continue
        out[int(asn)] = name
    return out


def fetch_bgp_tools_csv(
    url: str = BGP_TOOLS_URL, timeout: float = 60.0
) -> Dict[int, str]:
    """Download the bgp.tools ASN CSV and return {asn: name}."""
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = response.read().decode("utf-8", errors="replace")
    return parse_csv(body)


def build_subset(
    wanted: Iterable[int], all_names: Dict[int, str]
) -> Dict[str, str]:
    """Keep labels only for ``wanted`` ASNs, JSON-stringified and sorted.

    Sorting by integer keeps the output diff-friendly across refreshes;
    string keys keep the JSON valid (JSON objects cannot have integer
    keys) and consistent with the manually curated file the frontend
    already loads.
    """
    return {
        str(asn): all_names[asn]
        for asn in sorted(wanted)
        if asn in all_names
    }


def refresh(
    metrics_path: PathLike,
    out_path: PathLike,
    *,
    source_url: str = BGP_TOOLS_URL,
) -> int:
    """End-to-end: read metrics, fetch source, write subset JSON.

    Returns the number of ASNs written to the output file so callers
    (CLI, CI) can log a one-line summary.
    """
    metrics = json.loads(Path(metrics_path).read_text())
    wanted = extract_asns(metrics)
    all_names = fetch_bgp_tools_csv(source_url)
    subset = build_subset(wanted, all_names)
    payload = {
        "_about": {
            "purpose": (
                "Frontend labels for the Top Movers table. "
                "metrics.json remains the only source of truth for diff numbers."
            ),
            "source": source_url,
            "asn_count": len(subset),
        },
        **subset,
    }
    Path(out_path).write_text(json.dumps(payload, indent=2) + "\n")
    return len(subset)
