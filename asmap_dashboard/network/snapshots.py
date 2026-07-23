"""Source-agnostic loading of observed-node snapshots.

A *snapshot* is one crawler's view of the reachable network at a point in
time: ``(ip, port)`` peers, optionally annotated with the ASN/country the
crawler resolved. The metrics only consume the normalised ``Snapshot``
produced here, so adding a source is one ``load_*`` function plus a
``_LOADERS`` entry - the metric layer never learns a source's on-disk
quirks. The per-shape parsing details live in each ``load_*`` below.

The one source today is the Bitnodes crawler lineage: archived bitnodes.io
JSON crawls in two shapes followed by bitnod.es CSV exports (BitMEX).
Both forms are stamped ``source="bitnodes"`` and carry a ``lineage_stage``
so the payload can mark the export/host handoff without splitting the series.
CSV nodes carry no ASN until an independent WHOIS resolver annotates them.

Onion / I2P / CJDNS peers are dropped at load (no ASmap-resolvable IP);
the ``*_skipped`` counters on ``Snapshot`` preserve how many and why.
"""

from __future__ import annotations

import csv
import ipaddress
import json
import re
import sys
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from asmap_dashboard.loader import PathLike
from asmap_dashboard.network.whois import WhoisRecord, WhoisResolver

# Bitnodes ASN is "AS<digits>" or a non-AS sentinel ("TOR", null); only a
# real numeric ASN matches, anything else becomes ``None``.
_BITNODES_ASN_RE = re.compile(r"^AS(\d+)$")

# Per-node array offsets in the two Bitnodes JSON shapes. Named so the
# loaders read as field access, with one place to update on a schema bump.
_BITNODES_FULL_NODE_LEN = 13
_BITNODES_FULL_COUNTRY_IDX = 7
_BITNODES_FULL_ASN_IDX = 11

_BITNODES_OLD_ROW_MIN_LEN = 14
_BITNODES_OLD_COUNTRY_IDX = 9
_BITNODES_OLD_ASN_IDX = 13

# The bitnod.es CSV is a cumulative "last seen" dump. Keeping only rows
# seen within this many days of the file's newest date recovers a
# "currently reachable" set comparable to one JSON crawl (~9.7k clearnet);
# the whole file would track the rolling window and inflate the count by
# 50-80 %. One day (two calendar days) bridges a mid-day partial export.
_BITNODES_CSV_WINDOW_DAYS = 1

# Bitnod.es exports carry only a day; noon UTC anchors them within that day.
_BITNODES_CSV_HOUR_UTC = 12


@dataclass(frozen=True)
class Node:
    """One clearnet peer observed in a snapshot.

    ``asn`` / ``country`` are what the *crawler* resolved (for the ASN
    cross-check and per-country grouping). ``None`` when the source did
    not carry them; the metric layer reads ``None`` as "does not
    contribute to that metric" rather than guessing.
    """

    ip: str
    version: int
    asn: int | None
    country: str | None


@dataclass(frozen=True)
class Snapshot:
    """One crawler's normalised view of the network at ``timestamp``.

    ``nodes`` holds only address-resolvable clearnet peers; the
    ``*_skipped`` counters preserve how many were dropped and why, so the
    dashboard reports "9 876 clearnet of 10 538 observed" rather than
    silently shrinking the population.
    """

    source: str
    timestamp: int
    label: str
    nodes: tuple[Node, ...]
    observed_total: int
    onion_skipped: int
    unresolved_skipped: int
    lineage_stage: str = "archive"


def _make_node(ip: str, asn: int | None, country: str | None) -> Node | None:
    """Validate ``ip`` and build a Node, or return None for non-IP peers
    (onion / I2P / CJDNS or unparseable), which callers fold into their
    ``*_skipped`` tallies."""
    try:
        parsed = ipaddress.ip_address(ip)
    except ValueError:
        return None
    # ``country`` can arrive non-string from the bare-list Bitnodes rows,
    # so guard the type before normalising.
    country = (country.strip().upper() or None) if isinstance(country, str) else None
    return Node(ip=ip, version=parsed.version, asn=asn, country=country)


def _parse_host(addr: str) -> str | None:
    """Strip the port from a Bitnodes address key (``v4:port``,
    ``[v6]:port``, or bare), returning ``None`` for ``.onion`` peers."""
    addr = addr.strip()
    if addr.startswith("["):
        host = addr[1:].split("]", 1)[0]
    elif addr.count(":") == 1:
        host = addr.rsplit(":", 1)[0]
    else:
        host = addr
    if host.endswith(".onion"):
        return None
    return host


def _parse_bitnodes_asn(value: object) -> int | None:
    """Return the numeric ASN from a Bitnodes ``"AS<n>"`` field, else None."""
    if not isinstance(value, str):
        return None
    m = _BITNODES_ASN_RE.match(value.strip())
    return int(m.group(1)) if m else None


def load_bitnodes(path: PathLike) -> Snapshot:
    """Load a Bitnodes snapshot, dispatching on extension: ``.csv`` is a
    bitnod.es (BitMEX) export, everything else a JSON crawl. One entry
    point regardless of which forms a directory mixes."""
    path = Path(path)
    if path.suffix.lower() == ".csv":
        return load_bitnodes_csv(path)
    return load_bitnodes_snapshot(path)


def load_bitnodes_snapshot(path: PathLike) -> Snapshot:
    """Load a JSON Bitnodes snapshot into a Snapshot.

    Dispatches on the JSON's top-level type: a dict is a "good matches"
    crawl (``{"timestamp", "nodes": {...}}``), a list is "old best
    effort". Capture time is the embedded ``timestamp`` or the filename
    stem; a file with neither raises ``ValueError`` so
    ``discover_snapshots`` skips it instead of dating the crawl 1970.
    """
    path = Path(path)
    raw = json.loads(path.read_text())
    fallback_ts = _coerce_int(path.stem)

    if isinstance(raw, dict):
        timestamp = _coerce_int(raw.get("timestamp")) or fallback_ts
        if not timestamp:
            raise ValueError(f"{path.name}: no capture timestamp")
        return _load_bitnodes_good(raw, timestamp)
    if not fallback_ts:
        raise ValueError(f"{path.name}: no capture timestamp")
    return _load_bitnodes_old(raw, fallback_ts)


def load_bitnodes_csv(path: PathLike) -> Snapshot:
    """Load a bitnod.es (BitMEX) CSV export into a Snapshot.

    Columns: ``export_date, ip_address, port, country, isp, ...``. It is a
    cumulative "last seen" dump, so capture time is the newest
    ``export_date`` (noon UTC) and only rows within
    ``_BITNODES_CSV_WINDOW_DAYS`` of it are kept; the rest is the stale
    tail. No ``export_date`` raises ``ValueError`` so the file is skipped.
    No AS number (only ``isp``), so nodes initially load ``asn=None``.
    They retain the same ``bitnodes`` source id as the archive while the
    ``live`` lineage stage records the handoff.
    """
    path = Path(path)
    # These cumulative exports grow every day. A two-pass stream avoids
    # retaining millions of stale DictReader rows while still deriving the
    # capture date from file content instead of trusting the filename.
    newest: date | None = None
    with path.open(newline="") as fh:
        for row in csv.DictReader(fh):
            seen_on = _parse_iso_date(row.get("export_date"))
            if seen_on is not None and (newest is None or seen_on > newest):
                newest = seen_on
    if newest is None:
        raise ValueError(f"{path.name}: no parseable export_date")
    cutoff = newest - timedelta(days=_BITNODES_CSV_WINDOW_DAYS)
    timestamp = int(
        datetime(
            newest.year,
            newest.month,
            newest.day,
            _BITNODES_CSV_HOUR_UTC,
            tzinfo=timezone.utc,
        ).timestamp()
    )

    nodes: list[Node] = []
    onion = 0
    unresolved = 0
    observed = 0
    with path.open(newline="") as fh:
        for row in csv.DictReader(fh):
            seen_on = _parse_iso_date(row.get("export_date"))
            if seen_on is None or seen_on < cutoff:
                continue
            observed += 1
            host = _parse_host(str(row.get("ip_address") or ""))
            if host is None:
                onion += 1
                continue
            node = _make_node(host, None, row.get("country"))
            if node is None:
                unresolved += 1
                continue
            nodes.append(node)

    return Snapshot(
        source="bitnodes",
        timestamp=timestamp,
        label=_to_iso_date(timestamp),
        nodes=tuple(nodes),
        observed_total=observed,
        onion_skipped=onion,
        unresolved_skipped=unresolved,
        lineage_stage="live",
    )


def _parse_iso_date(value: object) -> date | None:
    """Parse a ``YYYY-MM-DD`` CSV field to a date, or None when unusable."""
    if not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value.strip())
    except ValueError:
        return None


def _load_bitnodes_good(raw: dict, timestamp: int) -> Snapshot:
    """Parse the ``{"timestamp", "nodes": {addr: [...]}}`` shape."""
    node_map = raw.get("nodes") or {}

    nodes: list[Node] = []
    onion = 0
    unresolved = 0
    for addr, fields in node_map.items():
        host = _parse_host(addr)
        if host is None:
            onion += 1
            continue
        asn, country = _bitnodes_node_annotations(fields)
        node = _make_node(host, asn, country)
        if node is None:
            unresolved += 1
            continue
        nodes.append(node)

    return Snapshot(
        source="bitnodes",
        timestamp=timestamp,
        label=_to_iso_date(timestamp),
        nodes=tuple(nodes),
        observed_total=len(node_map),
        onion_skipped=onion,
        unresolved_skipped=unresolved,
    )


def _load_bitnodes_old(rows: list, timestamp: int) -> Snapshot:
    """Parse the bare list-of-rows ("old best effort") shape."""
    nodes: list[Node] = []
    onion = 0
    unresolved = 0
    for row in rows:
        if not isinstance(row, list) or not row:
            unresolved += 1
            continue
        host = _parse_host(str(row[0]))
        if host is None:
            onion += 1
            continue
        asn = None
        country = None
        if len(row) >= _BITNODES_OLD_ROW_MIN_LEN:
            asn = _parse_bitnodes_asn(row[_BITNODES_OLD_ASN_IDX])
            country = row[_BITNODES_OLD_COUNTRY_IDX]
        node = _make_node(host, asn, country)
        if node is None:
            unresolved += 1
            continue
        nodes.append(node)

    return Snapshot(
        source="bitnodes",
        timestamp=timestamp,
        label=_to_iso_date(timestamp),
        nodes=tuple(nodes),
        observed_total=len(rows),
        onion_skipped=onion,
        unresolved_skipped=unresolved,
    )


def _bitnodes_node_annotations(fields: object) -> tuple[int | None, str | None]:
    """Pull (asn, country) from a full-form node array; the compact form
    carries no geo, so both come back ``None``."""
    if not isinstance(fields, list) or len(fields) < _BITNODES_FULL_NODE_LEN:
        return None, None
    asn = _parse_bitnodes_asn(fields[_BITNODES_FULL_ASN_IDX])
    country = fields[_BITNODES_FULL_COUNTRY_IDX]
    return asn, (country if isinstance(country, str) else None)


# Input source -> loader. Both JSON and CSV forms belong to one lineage.
_LOADERS = {"bitnodes": load_bitnodes}


def load_snapshot(path: PathLike, source: str) -> Snapshot:
    """Load one snapshot file using the loader registered for ``source``."""
    try:
        loader = _LOADERS[source]
    except KeyError:
        raise ValueError(
            f"unknown snapshot source {source!r}; expected one of {sorted(_LOADERS)}"
        ) from None
    return loader(path)


def discover_snapshots(
    directory: PathLike,
    source: str,
    whois_resolver: WhoisResolver | None = None,
) -> list[Snapshot]:
    """Load every ``*.json`` / ``*.csv`` snapshot under ``directory``, sorted
    in time.

    Recurses so subfolders and CSV exports are picked up in one pass. A
    snapshot that fails to parse or is malformed is skipped (with a stderr
    warning) rather than aborting the run, so one corrupt file does not
    take down the whole network section.
    """
    directory = Path(directory)
    out: list[Snapshot] = []
    paths = sorted([*directory.rglob("*.json"), *directory.rglob("*.csv")])
    for path in paths:
        try:
            out.append(load_snapshot(path, source))
        # Also catch the structural errors valid-but-wrong-shape JSON
        # raises in the loaders, not just parse failures.
        except (
            ValueError,
            json.JSONDecodeError,
            AttributeError,
            TypeError,
            KeyError,
            IndexError,
        ) as exc:
            print(
                f"warning: skipping {source} snapshot {path}: {exc}",
                file=sys.stderr,
            )
            continue
    out.sort(key=lambda s: s.timestamp)
    if whois_resolver is not None and out:
        # Current WHOIS describes current routing. Annotating old CSV exports
        # with today's origin ASN would manufacture historical attribution, so
        # only the newest snapshot receives fresh records.
        out[-1] = annotate_snapshot(out[-1], whois_resolver)
    return out


def annotate_snapshot(snapshot: Snapshot, resolver: WhoisResolver) -> Snapshot:
    """Fill missing crawler ASNs from independent WHOIS records in one batch."""
    missing = [node.ip for node in snapshot.nodes if node.asn is None]
    if not missing:
        return snapshot
    return _annotate_with_records(snapshot, resolver.resolve_many(missing))


def _annotate_with_records(
    snapshot: Snapshot, records: Mapping[str, WhoisRecord]
) -> Snapshot:
    nodes = tuple(_annotate_node(node, records) for node in snapshot.nodes)
    return Snapshot(
        source=snapshot.source,
        timestamp=snapshot.timestamp,
        label=snapshot.label,
        nodes=nodes,
        observed_total=snapshot.observed_total,
        onion_skipped=snapshot.onion_skipped,
        unresolved_skipped=snapshot.unresolved_skipped,
        lineage_stage=snapshot.lineage_stage,
    )


def _annotate_node(node: Node, records: Mapping[str, WhoisRecord]) -> Node:
    """Fill only missing annotations; preserve historical crawler truth."""
    if node.asn is not None:
        return node
    record = records.get(node.ip)
    if record is None:
        return node
    return Node(
        ip=node.ip,
        version=node.version,
        asn=record.asn,
        # Team Cymru's country is RIR allocation metadata, not GeoIP. Keep the
        # crawler's country value and use independent WHOIS only for the ASN.
        country=node.country,
    )


def _to_iso_date(unix_ts: int) -> str:
    return datetime.fromtimestamp(unix_ts, tz=timezone.utc).date().isoformat()


def _coerce_int(value: object) -> int | None:
    """Best-effort int() that returns None instead of raising."""
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
