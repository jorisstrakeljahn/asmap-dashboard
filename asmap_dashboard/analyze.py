"""Per-map static analysis for ASmap binary files."""

from __future__ import annotations

from asmap_dashboard._prefix import is_ipv4_prefix
from asmap_dashboard.loader import LoadedMap, PathLike, load_map

# Cap on top_ases rows. Matches TOP_MOVERS_LIMIT in diff.py in
# style (named constant at module top, used in the .most_common
# call below) so reviewers find both limits in the same place
# without grepping for magic numbers. The cap exists because the
# tail of the distribution is dominated by ASes with one or two
# prefixes, which carry no analytical value at the per-build
# overview tier.
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

    Counts entries, splits by address family, and ranks the most
    prefix-heavy ASes. Unmapped entries (ASN 0) are counted in the
    totals but excluded from the unique-AS count and the top-AS
    ranking, since ASN 0 is a sentinel rather than a real AS.

    Returns a dict with these keys:
        entries_count:        int, number of (prefix, asn) entries in
                              the trie's minimal-overlapping form.
        unique_asns:          int, number of distinct non-zero ASNs.
        ipv4_count:           int, entries whose prefix sits in
                              ::ffff:0:0/96.
        ipv6_count:           int, native IPv6 entries.
        ipv4_address_space:   int, total number of IPv4 addresses
                              assigned to a non-zero ASN. Read off
                              ``LoadedMap`` so the diff-side denominator
                              and the profile-side coverage report
                              cannot drift apart.
        ipv6_address_space:   int, same for IPv6.
        file_size_bytes:      int, raw size of the .dat file.
        top_ases:             list of {"asn": int, "prefix_count": int},
                              sorted by prefix_count descending, capped
                              at TOP_ASES_LIMIT entries.
    """
    # The same bit-comparison helper as diff.py; sharing the
    # address-family classifier means the analyze totals and the
    # diff buckets can never disagree on what counts as IPv4 for
    # the same .dat file.
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
