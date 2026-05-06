"""Per-map static analysis for ASmap binary files."""

from __future__ import annotations

import ipaddress
from collections import Counter
from pathlib import Path
from typing import Union

from asmap_dashboard._vendor.asmap import ASMap, prefix_to_net


def analyze_map(path: Union[str, Path]) -> dict:
    """Read an ASmap binary file and return a profile of its contents.

    The profile contains entry totals, address-family split, file size,
    and the top ASes by prefix count. Unmapped entries (ASN 0) are
    counted in totals but excluded from the unique-AS count and the
    top-AS ranking, since ASN 0 is a sentinel rather than a real AS.

    Returns a dict with these keys:
        entries_count:    int, number of (prefix, asn) entries in the trie.
        unique_asns:      int, number of distinct non-zero ASNs.
        ipv4_count:       int, entries whose prefix sits in ::ffff:0:0/96.
        ipv6_count:       int, native IPv6 entries.
        file_size_bytes:  int, raw size of the .dat file.
        top_ases:         list of {"asn": int, "prefix_count": int},
                          sorted by prefix_count descending, max 20.

    Raises:
        ValueError: if the file does not parse as a valid ASmap binary.
    """
    path = Path(path)
    bindata = path.read_bytes()
    asmap = ASMap.from_binary(bindata)
    if asmap is None:
        raise ValueError(f"{path} is not a valid ASmap binary file")

    entries = asmap.to_entries()
    ipv4_count = 0
    ipv6_count = 0
    asn_prefix_count: Counter[int] = Counter()
    for prefix, asn in entries:
        net = prefix_to_net(prefix)
        if isinstance(net, ipaddress.IPv4Network):
            ipv4_count += 1
        else:
            ipv6_count += 1
        if asn != 0:
            asn_prefix_count[asn] += 1

    top_ases = [
        {"asn": asn, "prefix_count": count}
        for asn, count in asn_prefix_count.most_common(20)
    ]

    return {
        "entries_count": len(entries),
        "unique_asns": len(asn_prefix_count),
        "ipv4_count": ipv4_count,
        "ipv6_count": ipv6_count,
        "file_size_bytes": len(bindata),
        "top_ases": top_ases,
    }
