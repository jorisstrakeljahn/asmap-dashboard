"""Per-map static analysis for ASmap binary files."""

from __future__ import annotations

from asmap_dashboard._prefix import is_ipv4_prefix
from asmap_dashboard.loader import LoadedMap, PathLike, load_map

# Cap on top_ases rows; the tail is one-or-two-prefix ASes with no value
# at the per-build overview tier.
TOP_ASES_LIMIT = 20


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

    Counts entries, splits by family, and ranks prefix-heavy ASes. ASN 0
    counts in the totals but not in ``unique_asns`` or ``top_ases``.

    Returns a dict:
        entries_count:        minimal-overlapping trie size.
        unique_asns:          distinct non-zero ASNs.
        ipv4_count/ipv6_count: entries per family.
        ipv{4,6}_address_space: addresses mapped to a non-zero ASN (read
                              off ``LoadedMap`` so it matches the diff).
        file_size_bytes:      raw .dat size.
        top_ases:             [{"asn", "prefix_count"}], capped at
                              TOP_ASES_LIMIT.
    """
    # Shares is_ipv4_prefix with diff/loader so the family split agrees.
    ipv4_count = 0
    ipv6_count = 0
    for prefix, _asn in loaded.asmap.to_entries():
        if is_ipv4_prefix(prefix):
            ipv4_count += 1
        else:
            ipv6_count += 1

    top_ases = [
        {"asn": asn, "prefix_count": count}
        for asn, count in loaded.entries_per_asn.most_common(TOP_ASES_LIMIT)
    ]

    return {
        "entries_count": loaded.entries_count,
        "unique_asns": len(loaded.entries_per_asn),
        "ipv4_count": ipv4_count,
        "ipv6_count": ipv6_count,
        "ipv4_address_space": loaded.ipv4_address_space,
        "ipv6_address_space": loaded.ipv6_address_space,
        "file_size_bytes": loaded.file_size_bytes,
        "top_ases": top_ases,
    }
