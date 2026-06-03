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
    ipv4_bucket_indices,
    is_ipv4_prefix,
    prefix_address_count,
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

    ``ipv4_bucket_space`` counts distinct /16 NetGroup buckets the
    map covers (any prefix with a non-zero ASN that touches a /16
    counts that /16 once). It is the denominator for the diff
    explorer match banner on the IPv4 side, expressed in the same
    peer-diversity bucket vocabulary Bitcoin Core's GetGroup() uses
    when no asmap is loaded.

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
    ipv4_bucket_space: int
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
    ipv4_per_asn, ipv6_per_asn, ipv4_bucket_space = _measure_per_asn_address_space(
        asmap
    )
    return LoadedMap(
        asmap=asmap,
        file_size_bytes=len(bindata),
        entries_count=len(minimal_entries),
        ipv4_address_space=sum(ipv4_per_asn.values()),
        ipv6_address_space=sum(ipv6_per_asn.values()),
        ipv4_bucket_space=ipv4_bucket_space,
        entries_per_asn=entries_per_asn,
        ipv4_addresses_per_asn=ipv4_per_asn,
        ipv6_addresses_per_asn=ipv6_per_asn,
    )


def _measure_per_asn_address_space(
    asmap: ASMap,
) -> tuple[Counter[int], Counter[int], int]:
    """Sum non-overlapping prefix sizes per ASN, split by address family.

    Walks the flat (non-overlapping) trie so each address is counted
    exactly once even when a smaller prefix overrides a larger
    parent. ASN 0 is the asmap sentinel for "no routing information"
    and is excluded so the totals represent address space the map
    actually has an opinion about, not raw trie coverage.

    Also accumulates the set of distinct /16 NetGroup buckets the
    map covers (every mapped IPv4 prefix contributes the /16s it
    touches). The third return value is the size of that set —
    ``ipv4_bucket_space`` on the LoadedMap.
    """
    ipv4_per_asn: Counter[int] = Counter()
    ipv6_per_asn: Counter[int] = Counter()
    ipv4_buckets: set[int] = set()
    for prefix, asn in asmap.to_entries(overlapping=False):
        if asn == 0:
            continue
        size = prefix_address_count(prefix)
        if is_ipv4_prefix(prefix):
            ipv4_per_asn[asn] += size
            ipv4_buckets.update(ipv4_bucket_indices(prefix))
        else:
            ipv6_per_asn[asn] += size
    return ipv4_per_asn, ipv6_per_asn, len(ipv4_buckets)
