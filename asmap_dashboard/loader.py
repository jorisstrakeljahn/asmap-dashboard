"""Shared loader for ASmap binary files.

Parses each .dat once into an ASMap plus the per-ASN caches analyze and
diff reuse, so the all-pairs diff loop never re-parses or re-walks the
same map.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from asmap_dashboard._prefix import (
    is_ipv4_prefix,
    merge_ranges,
    prefix_address_count,
    prefix_address_range,
)
from asmap_dashboard._vendor.asmap import ASMap

PathLike = str | Path


@dataclass(frozen=True)
class LoadedMap:
    """An ASmap binary file parsed once, ready for analyze or diff.

    All fields are precomputed at load so the all-pairs diff never
    re-walks the trie:

      ``entries_count``            minimal-overlapping trie size.
      ``ipv{4,6}_address_space``   addresses mapped to a non-zero ASN,
                                   per family - the headline drift
                                   denominator (weights a /8 over many
                                   tiny IPv6 allocations).
      ``ipv{4,6}_address_ranges``  the same coverage as sorted disjoint
                                   ``[start, end)`` ranges; the diff
                                   merges two maps' ranges into their
                                   union denominator.
      ``entries_per_asn``          trie leaves per AS (ASN 0 excluded).
      ``ipv{4,6}_addresses_per_asn`` addresses per AS, the Top Movers
                                   "Touched" denominator.

    The ``*_per_asn`` address counters sum to ``ipv{4,6}_address_space``
    by construction, so per-AS and headline views agree on "100 %".
    """

    asmap: ASMap
    file_size_bytes: int
    entries_count: int
    ipv4_address_space: int
    ipv6_address_space: int
    ipv4_address_ranges: tuple[tuple[int, int], ...]
    ipv6_address_ranges: tuple[tuple[int, int], ...]
    entries_per_asn: Counter[int]
    ipv4_addresses_per_asn: Counter[int]
    ipv6_addresses_per_asn: Counter[int]


def load_map(path: PathLike) -> LoadedMap:
    """Read a .dat file and return its parsed ASMap with on-disk size.

    Raises:
        ValueError: if the file does not parse as a valid ASmap binary.
    """
    path = Path(path)
    bindata = path.read_bytes()
    asmap = ASMap.from_binary(bindata)
    if asmap is None:
        raise ValueError(f"{path} is not a valid ASmap binary file")

    minimal_entries = asmap.to_entries()
    entries_per_asn: Counter[int] = Counter(
        asn for _prefix, asn in minimal_entries if asn != 0
    )
    ipv4_per_asn, ipv6_per_asn, ipv4_ranges, ipv6_ranges = (
        _measure_per_asn_address_space(asmap)
    )
    return LoadedMap(
        asmap=asmap,
        file_size_bytes=len(bindata),
        entries_count=len(minimal_entries),
        ipv4_address_space=sum(ipv4_per_asn.values()),
        ipv6_address_space=sum(ipv6_per_asn.values()),
        ipv4_address_ranges=tuple(merge_ranges(ipv4_ranges)),
        ipv6_address_ranges=tuple(merge_ranges(ipv6_ranges)),
        entries_per_asn=entries_per_asn,
        ipv4_addresses_per_asn=ipv4_per_asn,
        ipv6_addresses_per_asn=ipv6_per_asn,
    )


def _measure_per_asn_address_space(
    asmap: ASMap,
) -> tuple[Counter[int], Counter[int], list[tuple[int, int]], list[tuple[int, int]]]:
    """Sum non-overlapping prefix sizes per ASN, split by family, and
    collect each mapped prefix as a raw ``[start, end)`` range.

    Walks the flat trie so each address counts once; ASN 0 ("no routing
    info") is excluded. The caller merges the ranges into canonical form.
    """
    ipv4_per_asn: Counter[int] = Counter()
    ipv6_per_asn: Counter[int] = Counter()
    ipv4_ranges: list[tuple[int, int]] = []
    ipv6_ranges: list[tuple[int, int]] = []
    for prefix, asn in asmap.to_entries(overlapping=False):
        if asn == 0:
            continue
        size = prefix_address_count(prefix)
        if is_ipv4_prefix(prefix):
            ipv4_per_asn[asn] += size
            ipv4_ranges.append(prefix_address_range(prefix))
        else:
            ipv6_per_asn[asn] += size
            ipv6_ranges.append(prefix_address_range(prefix))
    return ipv4_per_asn, ipv6_per_asn, ipv4_ranges, ipv6_ranges
