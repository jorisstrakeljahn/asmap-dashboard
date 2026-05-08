"""Per-map static analysis for ASmap binary files."""

from __future__ import annotations

import ipaddress
from collections import Counter

from asmap_dashboard._vendor.asmap import prefix_to_net
from asmap_dashboard.loader import LoadedMap, PathLike, load_map


def analyze_map(path: PathLike) -> dict:
    """Read an ASmap binary file and return a profile of its contents.

    Convenience wrapper for one-shot use (CLI, single-file scripts).
    Pipelines that touch the same .dat file more than once should
    call ``load_map`` themselves and pass the result to
    ``analyze_loaded_map`` to skip a second parse.

    Returns the same dict described on ``analyze_loaded_map``.

    Raises:
        ValueError: if the file does not parse as a valid ASmap binary.
    """
    return analyze_loaded_map(load_map(path))


def analyze_loaded_map(loaded: LoadedMap) -> dict:
    """Profile an already-loaded ASmap.

    Counts entries, splits by address family, and ranks the most
    prefix-heavy ASes. Unmapped entries (ASN 0) are counted in the
    totals but excluded from the unique-AS count and the top-AS
    ranking, since ASN 0 is a sentinel rather than a real AS.

    Returns a dict with these keys:
        entries_count:    int, number of (prefix, asn) entries in the trie.
        unique_asns:      int, number of distinct non-zero ASNs.
        ipv4_count:       int, entries whose prefix sits in ::ffff:0:0/96.
        ipv6_count:       int, native IPv6 entries.
        file_size_bytes:  int, raw size of the .dat file.
        top_ases:         list of {"asn": int, "prefix_count": int},
                          sorted by prefix_count descending, max 20.
    """
    entries = loaded.asmap.to_entries()
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
        "file_size_bytes": loaded.file_size_bytes,
        "top_ases": top_ases,
    }
