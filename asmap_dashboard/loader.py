"""Shared loader for ASmap binary files.

Both the per-map profile (analyze) and the two-map diff need a
parsed ASMap and the on-disk size of the source file. Loading is
isolated here so the metrics pipeline can parse each .dat file
exactly once and feed the parsed result into every downstream
caller, instead of re-parsing the same file 2*(N-1) times across
the all-pairs diff loop.
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

    ``entries_count`` is the minimal-overlapping trie size (the form
    ``to_entries()`` returns by default). It is the historical
    "how big is this map?" number kept for backwards compatibility.

    ``ipv4_address_space`` / ``ipv6_address_space`` are the total
    number of IP addresses the map assigns a non-zero ASN to, split
    by family. This is the denominator the headline drift metric
    needs: a diff that touches a /8 weighs the same as one that
    touches 65 536 distinct /24 prefixes, both in terms of address
    coverage moved. Without this, IPv6 noise from many tiny
    allocations drowns out real IPv4 BGP reorganisations.

    ``ipv4_address_ranges`` / ``ipv6_address_ranges`` are the same
    coverage as sorted, disjoint half-open ``[start, end)`` ranges
    in each family's own address space (see ``_prefix``). The diff
    merges the ranges of two maps to obtain their union coverage —
    the denominator of the match banner and the drift ratios, where
    a per-map total would not be guaranteed to contain every
    changed prefix. Their total size equals
    ``ipv{4,6}_address_space`` by construction.

    The three ``*_per_asn`` Counters carry per-AS presence in each
    currency:

      ``entries_per_asn``         number of (prefix, asn) trie leaves
                                  the AS owns. Used by the diff to
                                  render the entry-level "Touched"
                                  multiplier and to filter ASN 0 out
                                  of roster counts.
      ``ipv4_addresses_per_asn``  IPv4 addresses the AS owns, summed
                                  over the AS's non-overlapping
                                  prefixes. Denominator for the per-AS
                                  IPv4 coverage view in Top Movers.
      ``ipv6_addresses_per_asn``  Same for IPv6.

    The address-space counters sum to ``ipv{4,6}_address_space`` by
    construction, so the per-AS view and the headline drift view
    cannot disagree on what "100 % of map X" means.

    Every field is precomputed at load time so the all-pairs diff
    loop never re-walks the trie for the same map.
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
    """Sum non-overlapping prefix sizes per ASN, split by address family.

    Walks the flat (non-overlapping) trie so each address is counted
    exactly once even when a smaller prefix overrides a larger
    parent. ASN 0 is the asmap sentinel for "no routing information"
    and is excluded so the totals represent address space the map
    actually has an opinion about, not raw trie coverage.

    Also collects every mapped prefix as a raw ``[start, end)``
    address range per family. The caller merges those into the
    canonical sorted disjoint form once, so the all-pairs diff loop
    can union two maps' coverage by a single merge instead of
    re-walking either trie.
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
