"""Refresh the frontend ASN \u2192 operator-name lookup table.

The dashboard renders top-mover rows as ``AS<num> (Operator)`` when a
human-readable name is available. The labels are sourced from
bgp.tools' canonical asns.csv dump, filtered down to the ASNs that
actually appear in the dashboard payloads (diffs.json's top movers
plus network.json's operator breakdown) so the JSON we ship to the
frontend stays compact (a few kilobytes instead of the full 5 MB
dump).

This module is intentionally a build-time utility, not part of the
analysis pipeline: analyze, diff, and metrics never touch it, and
the pipeline payloads remain the single source of truth for diff
numbers. A stale or missing ``asn-names.json`` only downgrades label
rendering to bare ``AS<num>``, which the frontend already handles.
"""

from __future__ import annotations

import csv
import io
import json
import sys
import urllib.request
from collections.abc import Iterable, Sequence
from pathlib import Path

PathLike = str | Path

BGP_TOOLS_URL = "https://bgp.tools/asns.csv"
# bgp.tools rejects requests without a descriptive User-Agent. Keep the
# string identifying the project so an operator triaging their logs can
# trace traffic back to this dashboard.
USER_AGENT = (
    "asmap-dashboard refresh-asn-names "
    "(+https://github.com/jorisstrakeljahn/asmap-dashboard)"
)


def extract_asns(metrics: dict) -> set[int]:
    """Return every ASN referenced in a dashboard payload.

    Collects, from each top-mover row, the row ``asn`` plus the
    per-family ``ipv4_primary_counterpart`` / ``ipv6_primary_counterpart``
    the Direction column actually renders — the per-family pick can
    differ from the row's own ASN ranking, so collecting only the row
    ASNs would leave counterpart cells unlabeled — and from the
    network section the operator breakdown
    (``network.sources[*].snapshots[*].top_ases``), so operator labels
    are fetched for the Top Movers table and the network tab alike.

    Two top-mover layouts are accepted so the same function works on
    every payload variant passed to ``refresh``:

      - ``diffs[*].top_movers`` — the nested layout, as in the
        combined stdout document.
      - ``top_movers`` keyed by ``"<from>|<to>"`` — the split detail
        file (diffs.json) the frontend lazy-loads.

    ASN 0 is the "unmapped" sentinel and is dropped so it never asks
    bgp.tools for a name that does not exist.
    """
    wanted: set[int] = set()

    def collect_row(row: dict) -> None:
        for key in ("asn", "ipv4_primary_counterpart", "ipv6_primary_counterpart"):
            value = row.get(key)
            if value:
                wanted.add(int(value))

    for diff in metrics.get("diffs", []):
        for row in diff.get("top_movers", []):
            collect_row(row)
    detail = metrics.get("top_movers")
    if isinstance(detail, dict):
        for rows in detail.values():
            for row in rows:
                collect_row(row)
    network = metrics.get("network") or {}
    for source in (network.get("sources") or {}).values():
        for snapshot in source.get("snapshots", []):
            for entry in snapshot.get("top_ases", []):
                value = entry.get("asn")
                if value:
                    wanted.add(int(value))
    return wanted


def parse_csv(body: str) -> dict[int, str]:
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
    out: dict[int, str] = {}
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
) -> dict[int, str]:
    """Download the bgp.tools ASN CSV and return {asn: name}."""
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = response.read().decode("utf-8", errors="replace")
    return parse_csv(body)


def build_subset(wanted: Iterable[int], all_names: dict[int, str]) -> dict[str, str]:
    """Keep labels only for ``wanted`` ASNs, JSON-stringified and sorted.

    Sorting by integer keeps the output diff-friendly across refreshes;
    string keys keep the JSON valid (JSON objects cannot have integer
    keys) and consistent with the manually curated file the frontend
    already loads.
    """
    return {str(asn): all_names[asn] for asn in sorted(wanted) if asn in all_names}


def refresh(
    payload_paths: PathLike | Sequence[PathLike],
    out_path: PathLike,
    *,
    source_url: str = BGP_TOOLS_URL,
) -> int:
    """End-to-end: read payloads, fetch source, write subset JSON.

    ``payload_paths`` is one path or a list of them (metrics.json,
    diffs.json, network.json after the payload split); the wanted-ASN
    set is the union across every file. Missing files are skipped
    with a stderr warning rather than failing the run: the network
    payload is optional by design (it only exists when snapshot
    sources were available at metrics time), and the same CI
    invocation must work in both worlds.

    Returns the number of ASNs written to the output file so callers
    (CLI, CI) can log a one-line summary.
    """
    if isinstance(payload_paths, (str, Path)):
        payload_paths = [payload_paths]
    wanted: set[int] = set()
    found = 0
    for path in payload_paths:
        path = Path(path)
        if not path.exists():
            print(f"warning: skipping missing payload {path}", file=sys.stderr)
            continue
        found += 1
        wanted |= extract_asns(json.loads(path.read_text()))
    # An empty ``wanted`` from existing-but-empty payloads is legitimate
    # (a build with no diffs yet) and proceeds to write a tiny file. But
    # if *no* payload existed at all — a CI path typo, a failed earlier
    # step — writing would replace a previously good ``asn-names.json``
    # with an empty subset and silently degrade every label on the
    # dashboard to a bare ``AS<num>``. Refuse before fetching the CSV.
    if found == 0:
        raise FileNotFoundError(
            "none of the payload files exist: "
            + ", ".join(str(p) for p in payload_paths)
        )
    all_names = fetch_bgp_tools_csv(source_url)
    subset = build_subset(wanted, all_names)
    payload = {
        "_about": {
            "purpose": (
                "Frontend labels for the Top Movers table. "
                "The pipeline payloads remain the only source of truth "
                "for diff numbers."
            ),
            "source": source_url,
            "asn_count": len(subset),
        },
        **subset,
    }
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2) + "\n")
    return len(subset)
