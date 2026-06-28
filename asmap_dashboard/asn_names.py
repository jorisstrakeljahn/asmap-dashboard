"""Refresh the frontend ASN \u2192 operator-name lookup table.

Labels top-mover rows as ``AS<num> (Operator)`` from bgp.tools' asns.csv,
filtered to the ASNs the payloads actually reference so the shipped JSON
stays a few kilobytes, not 5 MB. A build-time utility only: the pipeline
payloads stay the source of truth, and a missing file just downgrades
labels to bare ``AS<num>``.
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

    Collects each top-mover row's ``asn`` plus its rendered
    ``ipv{4,6}_primary_counterpart`` (which can differ from the row ASN),
    and the network section's ``top_ases`` operators. Accepts both
    top-mover layouts (nested ``diffs[*].top_movers`` and the split
    ``top_movers`` keyed ``"<from>|<to>"``). ASN 0 (unmapped) is dropped.
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

    Accepts both ``AS174`` and bare ``174`` ASN forms so a different
    mirror plugs in unchanged; rows missing a numeric asn or name are
    skipped, not fatal.
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
    """Keep labels only for ``wanted`` ASNs, as sorted string keys
    (integer-sorted for diff-friendly output, stringified for valid JSON)."""
    return {str(asn): all_names[asn] for asn in sorted(wanted) if asn in all_names}


def refresh(
    payload_paths: PathLike | Sequence[PathLike],
    out_path: PathLike,
    *,
    source_url: str = BGP_TOOLS_URL,
) -> int:
    """End-to-end: read payloads, fetch source, write subset JSON.

    ``payload_paths`` is one path or several; the wanted-ASN set is their
    union. Missing files are skipped with a warning (the network payload
    is optional), and the ASN count written is returned for a log line.
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
    # An empty ``wanted`` from present-but-empty payloads is fine. But if
    # *no* payload existed (a CI typo), writing would overwrite a good
    # asn-names.json with an empty subset - refuse before fetching.
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
