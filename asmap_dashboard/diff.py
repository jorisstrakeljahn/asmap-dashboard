"""Two-map diff with reassignment, newly-mapped and unmapped classification."""

from __future__ import annotations

import ipaddress
from collections import Counter, defaultdict
from pathlib import Path
from typing import Optional, Union

from asmap_dashboard._vendor.asmap import ASMap, net_to_prefix

PathLike = Union[str, Path]
TOP_MOVERS_LIMIT = 25


def diff_maps(
    map_a: PathLike,
    map_b: PathLike,
    addrs_file: Optional[PathLike] = None,
) -> dict:
    """Compute an aggregated diff between two ASmap binary files.

    Each prefix-level change is classified into one of three buckets:
      reassigned:   both maps assign the prefix, but to different ASes
      newly_mapped: ASN 0 in map_a, real ASN in map_b
      unmapped:     real ASN in map_a, ASN 0 in map_b

    Top movers are tracked with separate ``gained`` and ``lost`` counts
    per AS so the frontend can render the direction of a change without
    guessing. ``gained`` is the number of prefixes the AS picked up
    going from map_a to map_b (either reassigned-from-elsewhere or
    newly mapped); ``lost`` is the number it gave up (either reassigned
    elsewhere or unmapped). The primary counterpart is the AS most
    frequently exchanged with, picked from whichever direction has the
    larger count, so a row showing only newly_mapped activity reports
    its real source instead of an arbitrary 0.

    When ``addrs_file`` is given it is read line by line as one IP per
    line (blank lines and lines starting with '#' are skipped) and a
    bitcoin_node_impact section is included that counts how many of
    those IPs would resolve to a different ASN under map_b vs map_a.

    Returns a dict with these keys:
        entries_a:           int, entry count of map_a.
        entries_b:           int, entry count of map_b.
        total_changes:       int, sum of the three classification buckets.
        reassigned:          int.
        newly_mapped:        int.
        unmapped:            int.
        top_movers:          list of
            {"asn", "changes", "gained", "lost", "primary_counterpart"}.
        bitcoin_node_impact: optional dict, present only when addrs_file is set.
    """
    asmap_a = _load(map_a)
    asmap_b = _load(map_b)

    diff_entries = asmap_a.diff(asmap_b)

    reassigned = 0
    newly_mapped = 0
    unmapped = 0
    gained_per_as: Counter[int] = Counter()
    lost_per_as: Counter[int] = Counter()
    gained_from: dict[int, Counter[int]] = defaultdict(Counter)
    lost_to: dict[int, Counter[int]] = defaultdict(Counter)
    for _prefix, old_asn, new_asn in diff_entries:
        if old_asn == new_asn:
            continue
        if old_asn == 0:
            newly_mapped += 1
        elif new_asn == 0:
            unmapped += 1
        else:
            reassigned += 1
        if old_asn != 0:
            lost_per_as[old_asn] += 1
            lost_to[old_asn][new_asn] += 1
        if new_asn != 0:
            gained_per_as[new_asn] += 1
            gained_from[new_asn][old_asn] += 1

    changes_per_as: Counter[int] = Counter()
    for asn, count in lost_per_as.items():
        changes_per_as[asn] += count
    for asn, count in gained_per_as.items():
        changes_per_as[asn] += count

    top_movers = [
        _top_mover_row(asn, count, gained_per_as, lost_per_as, gained_from, lost_to)
        for asn, count in changes_per_as.most_common(TOP_MOVERS_LIMIT)
    ]

    result: dict = {
        "entries_a": len(asmap_a.to_entries()),
        "entries_b": len(asmap_b.to_entries()),
        "total_changes": reassigned + newly_mapped + unmapped,
        "reassigned": reassigned,
        "newly_mapped": newly_mapped,
        "unmapped": unmapped,
        "top_movers": top_movers,
    }
    if addrs_file is not None:
        result["bitcoin_node_impact"] = _node_impact(asmap_a, asmap_b, addrs_file)
    return result


def _top_mover_row(
    asn: int,
    count: int,
    gained_per_as: Counter,
    lost_per_as: Counter,
    gained_from: dict,
    lost_to: dict,
) -> dict:
    """Build one top_movers row with separate gained/lost counts.

    primary_counterpart is the most frequent partner AS in whichever
    direction (gain or loss) contributed more changes for this row.
    Ties favour the gain side.
    """
    gained = gained_per_as.get(asn, 0)
    lost = lost_per_as.get(asn, 0)
    if gained >= lost and gained_from[asn]:
        primary = gained_from[asn].most_common(1)[0][0]
    elif lost_to[asn]:
        primary = lost_to[asn].most_common(1)[0][0]
    else:
        primary = 0
    return {
        "asn": asn,
        "changes": count,
        "gained": gained,
        "lost": lost,
        "primary_counterpart": primary,
    }


def _load(path: PathLike) -> ASMap:
    bindata = Path(path).read_bytes()
    asmap = ASMap.from_binary(bindata)
    if asmap is None:
        raise ValueError(f"{path} is not a valid ASmap binary file")
    return asmap


def _node_impact(asmap_a: ASMap, asmap_b: ASMap, addrs_file: PathLike) -> dict:
    """Replay lookup() on each IP in addrs_file against both maps."""
    reassigned = 0
    newly_mapped = 0
    unmapped = 0
    total_nodes = 0
    for line in Path(addrs_file).read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        try:
            ip = ipaddress.ip_address(line)
        except ValueError:
            continue
        total_nodes += 1
        prefix = _ip_to_prefix(ip)
        asn_a = asmap_a.lookup(prefix) or 0
        asn_b = asmap_b.lookup(prefix) or 0
        if asn_a == asn_b:
            continue
        if asn_a == 0:
            newly_mapped += 1
        elif asn_b == 0:
            unmapped += 1
        else:
            reassigned += 1
    return {
        "total_nodes": total_nodes,
        "reassigned": reassigned,
        "newly_mapped": newly_mapped,
        "unmapped": unmapped,
        "total_affected": reassigned + newly_mapped + unmapped,
    }


def _ip_to_prefix(ip: ipaddress._BaseAddress) -> list:
    """Return the full-length bit prefix asmap.lookup() expects."""
    if isinstance(ip, ipaddress.IPv4Address):
        return net_to_prefix(ipaddress.IPv4Network(f"{ip}/32"))
    return net_to_prefix(ipaddress.IPv6Network(f"{ip}/128"))
