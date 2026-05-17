"""Two-map diff with reassignment, newly-mapped and unmapped classification."""

from __future__ import annotations

import ipaddress
from collections import Counter, defaultdict
from pathlib import Path
from typing import Optional

from asmap_dashboard._vendor.asmap import ASMap, net_to_prefix
from asmap_dashboard.loader import LoadedMap, PathLike, load_map


def count_entries_per_asn(loaded: LoadedMap) -> Counter:
    """Count prefix entries per ASN in the loaded trie, ignoring ASN 0.

    Walks every (prefix, asn) tuple once. Pipelines that compare the
    same map against many others should call this once per map and
    pass the result to ``diff_loaded_maps`` via the
    ``entries_per_asn_a`` / ``entries_per_asn_b`` kwargs to avoid
    re-walking each trie on every pair.

    ASN 0 is excluded because it is the asmap sentinel for "no
    routing information"; counting it would conflate genuine AS
    presence with coverage gaps.
    """
    counter: Counter[int] = Counter()
    for _prefix, asn in loaded.asmap.to_entries():
        if asn != 0:
            counter[asn] += 1
    return counter


# asmap stores both address families in the same bit-prefix trie
# by remapping every IPv4 prefix into the IPv4-mapped IPv6 range
# ::ffff:0:0/96 (see ``net_to_prefix`` in the vendored asmap.py).
# An IPv4 prefix therefore starts with 80 zero bits followed by 16
# one bits (0x...0000ffff); any prefix that does not match that
# 96-bit head is native IPv6.
#
# Comparing the bit-list head directly is cheaper than calling
# ``prefix_to_net`` per diff entry, which would allocate an
# ipaddress.IPv4Network / IPv6Network object for every change.
_V4_MAPPED_HEAD = [False] * 80 + [True] * 16


def _is_ipv4_prefix(prefix: list) -> bool:
    """Return True if ``prefix`` lives under ::ffff:0:0/96 (i.e. IPv4)."""
    if len(prefix) < 96:
        return False
    return prefix[:96] == _V4_MAPPED_HEAD

# Cap on how many top-mover ASes a single diff records. The cap
# exists to bound metrics.json size: an uncapped diff at the high
# end of the change distribution (~130k entry-level changes)
# touches a few thousand distinct ASes, and the long-long tail
# (ASes with one or two changes) carries no analytical value at
# the diff-explorer tier. 100 is the smallest cap that still
# resolves into the analytically meaningful population (the 100th
# row on a 25k-changes diff sits around 20-50 changes) while
# keeping the diffs portion of metrics.json well under 1 MB.
TOP_MOVERS_LIMIT = 100


def diff_maps(
    map_a: PathLike,
    map_b: PathLike,
    addrs_file: Optional[PathLike] = None,
) -> dict:
    """Compute an aggregated diff between two ASmap binary files.

    Convenience wrapper for one-shot use (CLI, single comparisons).
    Pipelines that compare the same map against many others should
    call ``load_map`` once per file and pass the results to
    ``diff_loaded_maps`` to skip per-call re-parsing.

    See ``diff_loaded_maps`` for the result shape.
    """
    return diff_loaded_maps(load_map(map_a), load_map(map_b), addrs_file=addrs_file)


def diff_loaded_maps(
    loaded_a: LoadedMap,
    loaded_b: LoadedMap,
    addrs_file: Optional[PathLike] = None,
    *,
    entries_per_asn_a: Optional[Counter] = None,
    entries_per_asn_b: Optional[Counter] = None,
) -> dict:
    """Compute an aggregated diff between two already-loaded ASmaps.

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

    Each top-mover row also carries ``entries_in_a`` and
    ``entries_in_b``: the total number of prefix entries the AS holds
    on either side. The frontend uses ``changes / max(entries_in_a,
    entries_in_b)`` to render the "Touched" significance multiplier,
    which answers "did this diff barely scratch a huge AS, or rip
    through a small one?". The multiplier can exceed 1.0 when the
    trie's diff granularity is finer than the AS's leaf count (see
    the frontend tooltip for the full explanation).

    ``entries_per_asn_a`` / ``entries_per_asn_b`` let the caller hand in
    pre-computed per-asn counts to avoid re-walking each trie on every
    pair in an all-pairs loop. When omitted, the diff falls back to
    walking each trie once via ``count_entries_per_asn``.

    When ``addrs_file`` is given it is read line by line as one IP per
    line (blank lines and lines starting with '#' are skipped) and a
    bitcoin_node_impact section is included that counts how many of
    those IPs would resolve to a different ASN under map_b vs map_a.

    Each of the three classification buckets also carries a v4 / v6
    split (``reassigned_ipv4`` / ``reassigned_ipv6`` and so on). The
    split lets the frontend answer "are the changes mostly IPv4 or
    IPv6?", which matters for Bitcoin Core peer diversity. The split
    fields sum back to the bucket total; an assertion in the test
    suite guards that invariant.

    Returns a dict with these keys:
        entries_a:           int, entry count of map_a.
        entries_b:           int, entry count of map_b.
        total_changes:       int, sum of the three classification buckets.
        reassigned:          int.
        reassigned_ipv4:     int, IPv4 share of ``reassigned``.
        reassigned_ipv6:     int, IPv6 share of ``reassigned``.
        newly_mapped:        int.
        newly_mapped_ipv4:   int.
        newly_mapped_ipv6:   int.
        unmapped:            int.
        unmapped_ipv4:       int.
        unmapped_ipv6:       int.
        as_total_a:          int, number of distinct autonomous systems
                             that hold at least one prefix in map_a.
        as_total_b:          int, same for map_b.
        as_appeared:         int, count of ASes present in map_b but not
                             in map_a. Peer-diversity signal: new ASes
                             are new potential buckets for Bitcoin Core
                             peer selection.
        as_disappeared:      int, count of ASes present in map_a but not
                             in map_b.
        top_movers:          list of {"asn", "changes", "gained", "lost",
                             "primary_counterpart", "entries_in_a",
                             "entries_in_b"}.
        bitcoin_node_impact: optional dict, present only when addrs_file is set.
    """
    asmap_a = loaded_a.asmap
    asmap_b = loaded_b.asmap

    if entries_per_asn_a is None:
        entries_per_asn_a = count_entries_per_asn(loaded_a)
    if entries_per_asn_b is None:
        entries_per_asn_b = count_entries_per_asn(loaded_b)

    diff_entries = asmap_a.diff(asmap_b)

    reassigned = 0
    reassigned_ipv4 = 0
    newly_mapped = 0
    newly_mapped_ipv4 = 0
    unmapped = 0
    unmapped_ipv4 = 0
    gained_per_as: Counter[int] = Counter()
    lost_per_as: Counter[int] = Counter()
    gained_from: dict[int, Counter[int]] = defaultdict(Counter)
    lost_to: dict[int, Counter[int]] = defaultdict(Counter)
    for prefix, old_asn, new_asn in diff_entries:
        if old_asn == new_asn:
            continue
        is_v4 = _is_ipv4_prefix(prefix)
        if old_asn == 0:
            newly_mapped += 1
            if is_v4:
                newly_mapped_ipv4 += 1
        elif new_asn == 0:
            unmapped += 1
            if is_v4:
                unmapped_ipv4 += 1
        else:
            reassigned += 1
            if is_v4:
                reassigned_ipv4 += 1
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
        _top_mover_row(
            asn,
            count,
            gained_per_as,
            lost_per_as,
            gained_from,
            lost_to,
            entries_per_asn_a,
            entries_per_asn_b,
        )
        for asn, count in changes_per_as.most_common(TOP_MOVERS_LIMIT)
    ]

    # AS roster delta. The Counter keys come straight from
    # to_entries() walks of each trie, so an ASN with at least one
    # leaf prefix shows up exactly once. Set arithmetic stays
    # cheap because ASN-space is small (~100k entries even on the
    # largest published map).
    asns_a = set(entries_per_asn_a)
    asns_b = set(entries_per_asn_b)

    result: dict = {
        "entries_a": loaded_a.entries_count,
        "entries_b": loaded_b.entries_count,
        "total_changes": reassigned + newly_mapped + unmapped,
        "reassigned": reassigned,
        "reassigned_ipv4": reassigned_ipv4,
        "reassigned_ipv6": reassigned - reassigned_ipv4,
        "newly_mapped": newly_mapped,
        "newly_mapped_ipv4": newly_mapped_ipv4,
        "newly_mapped_ipv6": newly_mapped - newly_mapped_ipv4,
        "unmapped": unmapped,
        "unmapped_ipv4": unmapped_ipv4,
        "unmapped_ipv6": unmapped - unmapped_ipv4,
        "as_total_a": len(asns_a),
        "as_total_b": len(asns_b),
        "as_appeared": len(asns_b - asns_a),
        "as_disappeared": len(asns_a - asns_b),
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
    entries_per_asn_a: Counter,
    entries_per_asn_b: Counter,
) -> dict:
    """Build one top_movers row with separate gained/lost counts.

    primary_counterpart is the most frequent partner AS in whichever
    direction (gain or loss) contributed more changes for this row.
    Ties favour the gain side.

    entries_in_a / entries_in_b carry the per-AS prefix counts on
    either side of the diff so the frontend can compute the
    "Touched" multiplier without a second pass over the data.
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
        "entries_in_a": entries_per_asn_a.get(asn, 0),
        "entries_in_b": entries_per_asn_b.get(asn, 0),
    }


def _node_impact(asmap_a: ASMap, asmap_b: ASMap, addrs_file: PathLike) -> dict:
    """Replay lookup() on each IP in addrs_file against both maps.

    Streams the address file line by line so this stays flat in memory
    even when the same file is replayed across many (map_a, map_b)
    pairs in the all-pairs Coverage pipeline.
    """
    reassigned = 0
    newly_mapped = 0
    unmapped = 0
    total_nodes = 0
    with Path(addrs_file).open(encoding="utf-8") as fh:
        for raw in fh:
            line = raw.strip()
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
