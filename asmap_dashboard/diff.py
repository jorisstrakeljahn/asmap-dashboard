"""Two-map diff with reassignment, newly-mapped and unmapped classification."""

from __future__ import annotations

import ipaddress
from collections import Counter, defaultdict
from pathlib import Path

from asmap_dashboard._prefix import (
    IPV4_BUCKET_SHIFT,
    IPV6_BUCKET_SHIFT,
    classify_asn_change,
    count_buckets,
    ip_to_prefix,
    is_ipv4_prefix,
    merge_ranges,
    prefix_address_count,
    prefix_address_range,
    total_range_size,
)
from asmap_dashboard._vendor.asmap import ASMap
from asmap_dashboard.loader import LoadedMap, PathLike, load_map

# Top-mover ASes recorded per currency. The roster is the union of the
# top ``TOP_MOVERS_LIMIT`` under each rendered currency (IPv4 then IPv6
# coverage). Caps the diffs.json size: the long tail of one-or-two-change
# ASes carries no value at this tier and is unreachable in the table.
TOP_MOVERS_LIMIT = 50


def diff_maps(
    map_a: PathLike,
    map_b: PathLike,
    addrs_file: PathLike | None = None,
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
    addrs_file: PathLike | None = None,
) -> dict:
    """Compute an aggregated diff between two already-loaded ASmaps.

    Each prefix-level change is classified into one of three buckets:
      reassigned:   both maps assign the prefix, but to different ASes
      newly_mapped: ASN 0 in map_a, real ASN in map_b
      unmapped:     real ASN in map_a, ASN 0 in map_b

    Two measurements per bucket: entry-level fields count distinct trie
    leaves (cheap, but a /8 weighs the same as a /48); coverage fields
    (``*_addresses``) weight each prefix by its address-space size and are
    the headline drift number, split per family because Core treats v4/v6
    as independent diversity dimensions. The two can diverge by an order
    of magnitude. IPv6 coverage exceeds 2**53, so JSON consumers round it
    to ~1e-16 relative error — harmless, since everything is quantised to
    /32 blocks before display; exact integer round-tripping is not
    promised.

    Top movers are ranked by the two rendered currencies (IPv4 then IPv6
    coverage; the union keeps every table-visible AS reachable). Each row
    carries: ``changes`` (entry-level total, tooltip only),
    ``ipv{4,6}_addresses_changed`` / ``_gained`` / ``_lost``,
    ``ipv{4,6}_primary_counterpart`` (the AS most space was exchanged
    with, from the larger direction so the arrow never points at 0), and
    ``ipv{4,6}_addresses_in_a`` / ``_in_b`` (per-AS coverage, the
    "Touched" denominator).

    With ``addrs_file`` (one IP per line, ``#`` comments skipped) a
    ``bitcoin_node_impact`` section counts how many of those IPs resolve
    to a different ASN under map_b vs map_a.

    Returns a dict with these keys (per-map entry counts are not repeated;
    the frontend reads them off the maps[] profiles):
        total_changes, reassigned[_ipv4/_ipv6], newly_mapped[_ipv4/_ipv6],
        unmapped[_ipv4/_ipv6]:         entry-level bucket counts.
        ipv{4,6}_address_space_union:  addresses mapped by map_a, map_b,
                                       or both. The union (not a single
                                       side) is the drift-ratio
                                       denominator every changed prefix
                                       falls under, so ratios stay <= 1.
        ipv4_buckets_changed / ipv4_bucket_space_union,
        ipv6_blocks_changed / ipv6_block_space_union:
                                       changed vs total /16 (IPv4) and
                                       /32 (IPv6) NetGroup buckets — the
                                       match banner's numerator/denominator.
        {reassigned,newly_mapped,unmapped}_ipv{4,6}_addresses:
                                       coverage-weighted change counts.
        ipv{4,6}_addresses_changed:    sum of the three coverage buckets.
        as_total_a / as_total_b:       distinct ASes per map.
        as_appeared / as_disappeared:  ASes only in map_b / only in map_a.
        top_movers:                    per-AS rows (see above).
        bitcoin_node_impact:           present only with addrs_file.
    """
    asmap_a = loaded_a.asmap
    asmap_b = loaded_b.asmap

    buckets = _DiffBuckets()
    activity = _PerAsActivity()
    # Changed prefixes as address ranges, so the match-banner bucket
    # counts come from one merge below.
    changed_ipv4_ranges: list[tuple[int, int]] = []
    changed_ipv6_ranges: list[tuple[int, int]] = []
    for prefix, old_asn, new_asn in asmap_a.diff(asmap_b):
        if old_asn == new_asn:
            continue
        is_v4 = is_ipv4_prefix(prefix)
        addresses = prefix_address_count(prefix)
        buckets.record(old_asn, new_asn, is_v4, addresses)
        activity.record(old_asn, new_asn, is_v4, addresses)
        if is_v4:
            changed_ipv4_ranges.append(prefix_address_range(prefix))
        else:
            changed_ipv6_ranges.append(prefix_address_range(prefix))

    # Union coverage = addresses either map has an opinion about. Every
    # changed prefix falls inside it, so the ratios never exceed 100 %.
    union_ipv4 = merge_ranges(
        [*loaded_a.ipv4_address_ranges, *loaded_b.ipv4_address_ranges]
    )
    union_ipv6 = merge_ranges(
        [*loaded_a.ipv6_address_ranges, *loaded_b.ipv6_address_ranges]
    )
    changed_ipv4 = merge_ranges(changed_ipv4_ranges)
    changed_ipv6 = merge_ranges(changed_ipv6_ranges)

    ranked_asns = activity.ranked_asns(TOP_MOVERS_LIMIT)
    top_movers = [activity.row(asn, loaded_a, loaded_b) for asn in ranked_asns]

    # ``entries_per_asn`` keys are the ASNs with a non-zero leaf (ASN 0
    # excluded), the right population for the roster delta.
    asns_a = set(loaded_a.entries_per_asn)
    asns_b = set(loaded_b.entries_per_asn)

    result: dict = {
        "total_changes": buckets.total_changes(),
        "reassigned": buckets.reassigned,
        "reassigned_ipv4": buckets.reassigned_ipv4,
        "reassigned_ipv6": buckets.reassigned - buckets.reassigned_ipv4,
        "newly_mapped": buckets.newly_mapped,
        "newly_mapped_ipv4": buckets.newly_mapped_ipv4,
        "newly_mapped_ipv6": buckets.newly_mapped - buckets.newly_mapped_ipv4,
        "unmapped": buckets.unmapped,
        "unmapped_ipv4": buckets.unmapped_ipv4,
        "unmapped_ipv6": buckets.unmapped - buckets.unmapped_ipv4,
        "ipv4_address_space_union": total_range_size(union_ipv4),
        "ipv6_address_space_union": total_range_size(union_ipv6),
        "ipv4_buckets_changed": count_buckets(changed_ipv4, IPV4_BUCKET_SHIFT),
        "ipv4_bucket_space_union": count_buckets(union_ipv4, IPV4_BUCKET_SHIFT),
        "ipv6_blocks_changed": count_buckets(changed_ipv6, IPV6_BUCKET_SHIFT),
        "ipv6_block_space_union": count_buckets(union_ipv6, IPV6_BUCKET_SHIFT),
        "reassigned_ipv4_addresses": buckets.reassigned_ipv4_addresses,
        "reassigned_ipv6_addresses": buckets.reassigned_ipv6_addresses,
        "newly_mapped_ipv4_addresses": buckets.newly_mapped_ipv4_addresses,
        "newly_mapped_ipv6_addresses": buckets.newly_mapped_ipv6_addresses,
        "unmapped_ipv4_addresses": buckets.unmapped_ipv4_addresses,
        "unmapped_ipv6_addresses": buckets.unmapped_ipv6_addresses,
        "ipv4_addresses_changed": buckets.ipv4_addresses_changed(),
        "ipv6_addresses_changed": buckets.ipv6_addresses_changed(),
        "as_total_a": len(asns_a),
        "as_total_b": len(asns_b),
        "as_appeared": len(asns_b - asns_a),
        "as_disappeared": len(asns_a - asns_b),
        "top_movers": top_movers,
    }
    if addrs_file is not None:
        result["bitcoin_node_impact"] = _node_impact(asmap_a, asmap_b, addrs_file)
    return result


class _DiffBuckets:
    """Accumulator for the three change buckets, by family, so the
    per-prefix loop reads as "classify and record" not a bookkeeping
    ladder."""

    def __init__(self) -> None:
        self.reassigned = 0
        self.reassigned_ipv4 = 0
        self.newly_mapped = 0
        self.newly_mapped_ipv4 = 0
        self.unmapped = 0
        self.unmapped_ipv4 = 0
        self.reassigned_ipv4_addresses = 0
        self.reassigned_ipv6_addresses = 0
        self.newly_mapped_ipv4_addresses = 0
        self.newly_mapped_ipv6_addresses = 0
        self.unmapped_ipv4_addresses = 0
        self.unmapped_ipv6_addresses = 0

    def record(self, old_asn: int, new_asn: int, is_v4: bool, addresses: int) -> None:
        change = classify_asn_change(old_asn, new_asn)
        if change == "newly_mapped":
            self.newly_mapped += 1
            if is_v4:
                self.newly_mapped_ipv4 += 1
                self.newly_mapped_ipv4_addresses += addresses
            else:
                self.newly_mapped_ipv6_addresses += addresses
        elif change == "unmapped":
            self.unmapped += 1
            if is_v4:
                self.unmapped_ipv4 += 1
                self.unmapped_ipv4_addresses += addresses
            else:
                self.unmapped_ipv6_addresses += addresses
        elif change == "reassigned":
            self.reassigned += 1
            if is_v4:
                self.reassigned_ipv4 += 1
                self.reassigned_ipv4_addresses += addresses
            else:
                self.reassigned_ipv6_addresses += addresses

    def total_changes(self) -> int:
        return self.reassigned + self.newly_mapped + self.unmapped

    def ipv4_addresses_changed(self) -> int:
        return (
            self.reassigned_ipv4_addresses
            + self.newly_mapped_ipv4_addresses
            + self.unmapped_ipv4_addresses
        )

    def ipv6_addresses_changed(self) -> int:
        return (
            self.reassigned_ipv6_addresses
            + self.newly_mapped_ipv6_addresses
            + self.unmapped_ipv6_addresses
        )


class _PerAsActivity:
    """Per-AS gained / lost counters in all three currencies, side by side
    so the top-N union pass and the row builder share one source."""

    def __init__(self) -> None:
        # Entry-level counters feed only the row's ``changes`` total and
        # the entries leg of ranking; no per-direction counterpart map.
        self._gained_entries: Counter[int] = Counter()
        self._lost_entries: Counter[int] = Counter()
        self._gained_ipv4: Counter[int] = Counter()
        self._lost_ipv4: Counter[int] = Counter()
        self._gained_ipv6: Counter[int] = Counter()
        self._lost_ipv6: Counter[int] = Counter()
        self._gained_from_ipv4: dict[int, Counter[int]] = defaultdict(Counter)
        self._lost_to_ipv4: dict[int, Counter[int]] = defaultdict(Counter)
        self._gained_from_ipv6: dict[int, Counter[int]] = defaultdict(Counter)
        self._lost_to_ipv6: dict[int, Counter[int]] = defaultdict(Counter)

    def record(self, old_asn: int, new_asn: int, is_v4: bool, addresses: int) -> None:
        if old_asn != 0:
            self._lost_entries[old_asn] += 1
            if is_v4:
                self._lost_ipv4[old_asn] += addresses
                self._lost_to_ipv4[old_asn][new_asn] += addresses
            else:
                self._lost_ipv6[old_asn] += addresses
                self._lost_to_ipv6[old_asn][new_asn] += addresses
        if new_asn != 0:
            self._gained_entries[new_asn] += 1
            if is_v4:
                self._gained_ipv4[new_asn] += addresses
                self._gained_from_ipv4[new_asn][old_asn] += addresses
            else:
                self._gained_ipv6[new_asn] += addresses
                self._gained_from_ipv6[new_asn][old_asn] += addresses

    def ranked_asns(self, limit: int) -> list[int]:
        """Union of the top ``limit`` ASes per rendered currency (IPv4
        coverage then IPv6 — the only two the table sorts by, so an
        entry-only AS never arrives as an unsortable row). IPv4 first wins
        ties, matching the table's default view.
        """
        ordered: dict[int, None] = {}
        for asn, count in self._total(self._gained_ipv4, self._lost_ipv4).most_common(
            limit
        ):
            if count > 0:
                ordered.setdefault(asn, None)
        for asn, count in self._total(self._gained_ipv6, self._lost_ipv6).most_common(
            limit
        ):
            if count > 0:
                ordered.setdefault(asn, None)
        return list(ordered)

    @staticmethod
    def _total(gained: Counter[int], lost: Counter[int]) -> Counter[int]:
        """Per-AS total = gained + lost.

        Lost is folded first so a tie ranks the losing AS ahead (the more
        natural headline of a reassignment). Manual summing (not
        Counter+Counter) keeps zero rows the union pass still needs.
        """
        combined: Counter[int] = Counter()
        for asn, count in lost.items():
            combined[asn] += count
        for asn, count in gained.items():
            combined[asn] += count
        return combined

    def row(self, asn: int, loaded_a: LoadedMap, loaded_b: LoadedMap) -> dict:
        """Build one top_movers row for ``asn``. The ``*_in_a`` / ``*_in_b``
        presence figures come from the loader caches, so no trie re-walk."""
        gained_entries = self._gained_entries.get(asn, 0)
        lost_entries = self._lost_entries.get(asn, 0)
        gained_ipv4 = self._gained_ipv4.get(asn, 0)
        lost_ipv4 = self._lost_ipv4.get(asn, 0)
        gained_ipv6 = self._gained_ipv6.get(asn, 0)
        lost_ipv6 = self._lost_ipv6.get(asn, 0)
        return {
            "asn": asn,
            "changes": gained_entries + lost_entries,
            "ipv4_addresses_changed": gained_ipv4 + lost_ipv4,
            "ipv4_addresses_gained": gained_ipv4,
            "ipv4_addresses_lost": lost_ipv4,
            "ipv4_primary_counterpart": _primary_counterpart(
                gained_ipv4,
                lost_ipv4,
                self._gained_from_ipv4.get(asn),
                self._lost_to_ipv4.get(asn),
            ),
            "ipv4_addresses_in_a": loaded_a.ipv4_addresses_per_asn.get(asn, 0),
            "ipv4_addresses_in_b": loaded_b.ipv4_addresses_per_asn.get(asn, 0),
            "ipv6_addresses_changed": gained_ipv6 + lost_ipv6,
            "ipv6_addresses_gained": gained_ipv6,
            "ipv6_addresses_lost": lost_ipv6,
            "ipv6_primary_counterpart": _primary_counterpart(
                gained_ipv6,
                lost_ipv6,
                self._gained_from_ipv6.get(asn),
                self._lost_to_ipv6.get(asn),
            ),
            "ipv6_addresses_in_a": loaded_a.ipv6_addresses_per_asn.get(asn, 0),
            "ipv6_addresses_in_b": loaded_b.ipv6_addresses_per_asn.get(asn, 0),
        }


def _primary_counterpart(
    gained: int,
    lost: int,
    gained_from: Counter[int] | None,
    lost_to: Counter[int] | None,
) -> int:
    """The single AS this row most exchanged space with. The larger
    direction (gained vs lost) wins so the arrow points at the real
    source/destination, not an arbitrary 0; ties favour the gain side."""
    if gained >= lost and gained_from:
        return gained_from.most_common(1)[0][0]
    if lost_to:
        return lost_to.most_common(1)[0][0]
    return 0


def _node_impact(asmap_a: ASMap, asmap_b: ASMap, addrs_file: PathLike) -> dict:
    """Replay lookup() on each IP in addrs_file against both maps,
    streaming the file so memory stays flat across many pairs."""
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
            prefix = ip_to_prefix(ip)
            asn_a = asmap_a.lookup(prefix) or 0
            asn_b = asmap_b.lookup(prefix) or 0
            change = classify_asn_change(asn_a, asn_b)
            if change == "newly_mapped":
                newly_mapped += 1
            elif change == "unmapped":
                unmapped += 1
            elif change == "reassigned":
                reassigned += 1
    return {
        "total_nodes": total_nodes,
        "reassigned": reassigned,
        "newly_mapped": newly_mapped,
        "unmapped": unmapped,
        "total_affected": reassigned + newly_mapped + unmapped,
    }
