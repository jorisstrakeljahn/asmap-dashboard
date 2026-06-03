"""Source-agnostic loading of observed-node snapshots.

A *snapshot* is one crawler's view of the reachable Bitcoin network at a
point in time: a list of ``(ip, port)`` peers, optionally annotated with
the ASN and country the crawler resolved for each. The network-tap
metrics only ever consume the normalised ``Snapshot`` produced here, so
adding a new data source means writing one ``load_*`` function and
registering it in ``_LOADERS`` — the metric code never learns a source's
on-disk quirks.

Two sources are supported today:

  KIT dossiers
    Hourly JSON dumps from the Karlsruhe Institute of Technology monitor
    nodes. One object keyed by the Python ``repr()`` of an
    ``(IPvNAddress(...), port)`` tuple, each value carrying a ``whois``
    block with the ASN and country the crawler resolved. Every node
    carries full whois, so KIT feeds the ASN cross-check and the
    per-country breakdown for every snapshot. The capture time is encoded
    in the filename (``YYYYMMDD_HHMMSS_dossier.json``).

  Bitnodes snapshots
    Crawls shared by b10c, in two shapes that this loader unifies:
      - "good matches": ``{"timestamp", "nodes": {"addr:port": [...]}}``.
        The per-node array is either the *compact* form
        ``[proto, ua, since, services, height]`` (no geo) or the *full*
        form that additionally carries ``[..., country@7, ..., "AS<n>"@11,
        name@12]``. Only the full form feeds cross-check / per-country.
      - "old best effort": a bare list of rows
        ``[addr, port, proto, ua, since, ..., country@9, ..., "AS<n>"@13,
        name@14]``. The capture time is the filename stem (a unix ts).

Onion / I2P / CJDNS peers are dropped at load time: they have no IP that
ASmap can resolve, so they cannot participate in any ASmap-derived metric
(see the ``onion_skipped`` / ``unresolved_skipped`` diagnostics on the
``Snapshot``). Keeping that filter here means the metric layer only ever
sees address-resolvable nodes.
"""

from __future__ import annotations

import ipaddress
import json
import re
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

PathLike = str | Path

# KIT keys are Python repr() of an (IPvNAddress('<ip>'), port) tuple, e.g.
#   "(IPv4Address('5.39.74.166'), 8333)"
# This pulls the quoted address out without eval()-ing untrusted input.
_KIT_ADDRESS_RE = re.compile(r"Address\('([^']+)'\)")

# Bitnodes encodes the resolved ASN as "AS<digits>" or the sentinel "TOR"
# (and occasionally null). Anything that is not a real numeric ASN
# resolves to ``None`` so the cross-check never compares against a
# non-AS placeholder.
_BITNODES_ASN_RE = re.compile(r"^AS(\d+)$")

# Per-node array offsets in the two Bitnodes shapes. Named here so the
# loaders read as field access rather than magic indices, and so a future
# Bitnodes schema bump has exactly one place to update.
_BITNODES_FULL_NODE_LEN = 13
_BITNODES_FULL_COUNTRY_IDX = 7
_BITNODES_FULL_ASN_IDX = 11

_BITNODES_OLD_ROW_MIN_LEN = 14
_BITNODES_OLD_COUNTRY_IDX = 9
_BITNODES_OLD_ASN_IDX = 13


@dataclass(frozen=True)
class Node:
    """One clearnet peer observed in a snapshot.

    ``asn`` and ``country`` are the values the *crawler* resolved, kept
    only so the ASN cross-check can compare them against the ASmap
    lookup and so the per-country breakdown has a grouping key. They are
    ``None`` whenever the source did not carry them (e.g. Bitnodes'
    compact node arrays), and the metric layer treats ``None`` as
    "this node does not contribute to that particular metric" rather
    than guessing.
    """

    ip: str
    version: int
    asn: int | None
    country: str | None


@dataclass(frozen=True)
class Snapshot:
    """One crawler's normalised view of the network at ``timestamp``.

    ``nodes`` holds only address-resolvable clearnet peers; the two
    ``*_skipped`` counters preserve how many peers were dropped and why,
    so the dashboard can report (for example) "9 876 clearnet of 10 538
    observed, 662 onion" instead of silently shrinking the population.
    """

    source: str
    timestamp: int
    label: str
    nodes: tuple[Node, ...]
    observed_total: int
    onion_skipped: int
    unresolved_skipped: int


def _make_node(ip: str, asn: int | None, country: str | None) -> Node | None:
    """Validate ``ip`` and build a Node, or return None for non-IP peers.

    Returns ``None`` for onion / I2P / CJDNS addresses and anything that
    does not parse as an IP, so callers can fold the rejects straight
    into their ``*_skipped`` tallies.
    """
    try:
        parsed = ipaddress.ip_address(ip)
    except ValueError:
        return None
    country = (country or "").strip().upper() or None
    return Node(ip=ip, version=parsed.version, asn=asn, country=country)


def _parse_host(addr: str) -> str | None:
    """Strip the port from a Bitnodes address key, dropping onion peers.

    Handles the three shapes Bitnodes emits: ``v4:port``,
    ``[v6]:port``, and bare addresses (old-best-effort rows store the
    address without a port). Returns ``None`` for ``.onion`` peers so
    they never reach ``ipaddress.ip_address``.
    """
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


def load_kit_dossier(path: PathLike) -> Snapshot:
    """Load a KIT hourly dossier into a Snapshot.

    The capture time comes from the filename stem
    (``YYYYMMDD_HHMMSS_dossier``); KIT writes one dossier per hour and
    the analyst picked the ~12:00 file for each day, so the stem is the
    authoritative timestamp.
    """
    path = Path(path)
    raw = json.loads(path.read_text())
    timestamp = _kit_timestamp(path.stem)

    nodes: list[Node] = []
    onion = 0
    unresolved = 0
    for key, value in raw.items():
        m = _KIT_ADDRESS_RE.search(key)
        if not m:
            unresolved += 1
            continue
        ip = m.group(1)
        whois = value.get("whois") or {}
        asn = _coerce_int(whois.get("asn"))
        country = whois.get("asn_country_code")
        node = _make_node(ip, asn, country)
        if node is None:
            onion += 1
            continue
        nodes.append(node)

    return Snapshot(
        source="kit",
        timestamp=timestamp,
        label=_iso_date(timestamp),
        nodes=tuple(nodes),
        observed_total=len(raw),
        onion_skipped=onion,
        unresolved_skipped=unresolved,
    )


def load_bitnodes_snapshot(path: PathLike) -> Snapshot:
    """Load a Bitnodes snapshot (either on-disk shape) into a Snapshot.

    Dispatches on the parsed JSON's top-level type: a dict is a
    "good matches" crawl (``{"timestamp", "nodes": {...}}``), a list is
    an "old best effort" crawl. The capture time is the embedded
    ``timestamp`` when present, otherwise the filename stem.
    """
    path = Path(path)
    raw = json.loads(path.read_text())
    fallback_ts = _coerce_int(path.stem) or 0

    if isinstance(raw, dict):
        return _load_bitnodes_good(raw, fallback_ts)
    return _load_bitnodes_old(raw, fallback_ts)


def _load_bitnodes_good(raw: dict, fallback_ts: int) -> Snapshot:
    """Parse the ``{"timestamp", "nodes": {addr: [...]}}`` shape."""
    timestamp = _coerce_int(raw.get("timestamp")) or fallback_ts
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
        label=_iso_date(timestamp),
        nodes=tuple(nodes),
        observed_total=len(node_map),
        onion_skipped=onion,
        unresolved_skipped=unresolved,
    )


def _load_bitnodes_old(rows: list, fallback_ts: int) -> Snapshot:
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
        timestamp=fallback_ts,
        label=_iso_date(fallback_ts),
        nodes=tuple(nodes),
        observed_total=len(rows),
        onion_skipped=onion,
        unresolved_skipped=unresolved,
    )


def _bitnodes_node_annotations(fields: object) -> tuple[int | None, str | None]:
    """Pull (asn, country) from a good-match node array, if it is the full form.

    The compact 5-element array carries no geo, so both come back
    ``None`` and the node still counts toward the IP-only metrics.
    """
    if not isinstance(fields, list) or len(fields) < _BITNODES_FULL_NODE_LEN:
        return None, None
    asn = _parse_bitnodes_asn(fields[_BITNODES_FULL_ASN_IDX])
    country = fields[_BITNODES_FULL_COUNTRY_IDX]
    return asn, (country if isinstance(country, str) else None)


# Registry mapping a source name to its loader. ``discover_snapshots``
# and ``load_snapshot`` route through this, so wiring a new crawler in
# is a one-line addition here plus the loader itself.
_LOADERS = {
    "kit": load_kit_dossier,
    "bitnodes": load_bitnodes_snapshot,
}


def load_snapshot(path: PathLike, source: str) -> Snapshot:
    """Load one snapshot file using the loader registered for ``source``."""
    try:
        loader = _LOADERS[source]
    except KeyError:
        raise ValueError(
            f"unknown snapshot source {source!r}; expected one of {sorted(_LOADERS)}"
        ) from None
    return loader(path)


def discover_snapshots(directory: PathLike, source: str) -> list[Snapshot]:
    """Load every ``*.json`` snapshot under ``directory``, sorted in time.

    Recurses so the Bitnodes "old best effort" subfolder is picked up
    alongside the good matches in the same pass. Files that fail to
    parse are skipped rather than aborting the run, because one corrupt
    snapshot should not take down the whole network section.
    """
    directory = Path(directory)
    out: list[Snapshot] = []
    for path in sorted(directory.rglob("*.json")):
        try:
            out.append(load_snapshot(path, source))
        except (ValueError, json.JSONDecodeError):
            continue
    out.sort(key=lambda s: s.timestamp)
    return out


def _kit_timestamp(stem: str) -> int:
    """Convert a ``YYYYMMDD_HHMMSS_dossier`` stem to a unix timestamp."""
    head = stem.split("_dossier", 1)[0]
    dt = datetime.strptime(head, "%Y%m%d_%H%M%S").replace(tzinfo=timezone.utc)
    return int(dt.timestamp())


def _iso_date(unix_ts: int) -> str:
    return datetime.fromtimestamp(unix_ts, tz=timezone.utc).date().isoformat()


def _coerce_int(value: object) -> int | None:
    """Best-effort int() that returns None instead of raising."""
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def total_nodes(snapshots: Iterable[Snapshot]) -> int:
    """Sum of clearnet node counts across snapshots (diagnostic helper)."""
    return sum(len(s.nodes) for s in snapshots)
