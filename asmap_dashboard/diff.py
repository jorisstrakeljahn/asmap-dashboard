"""Two-map diff with reassignment, newly-mapped and unmapped classification."""

from __future__ import annotations

import ipaddress
from collections import Counter, defaultdict
from pathlib import Path

from asmap_dashboard._prefix import (
    ipv4_bucket_indices,
    is_ipv4_prefix,
    prefix_address_count,
)
from asmap_dashboard._vendor.asmap import ASMap, net_to_prefix
from asmap_dashboard.loader import LoadedMap, PathLike, load_map

# Cap on how many top-mover ASes a single diff records *per
# currency*. A single AS that ranks in the top N by entries, by
# IPv4 coverage and by IPv6 coverage shows up exactly once thanks
# to the union below, so the actual upper bound on row count is
# ``3 * TOP_MOVERS_LIMIT`` in the (rare) pathological case where
# the three rankings disagree completely. Real diffs see heavy
# overlap because the biggest ASes dominate every currency, so the
# union typically lands closer to ``1.2 - 1.5 * TOP_MOVERS_LIMIT``.
#
# The cap exists to bound metrics.json size: an uncapped diff at
# the high end of the change distribution touches a few thousand
# distinct ASes and the long-long tail (ASes with one or two
# changes) carries no analytical value at the diff-explorer tier.
# 100 is the smallest cap that still resolves into the analytically
# meaningful population (the 100th row on a 25k-changes diff sits
# around 20-50 changes) while keeping the diffs portion of
# metrics.json well under 1 MB even after the union.
TOP_MOVERS_LIMIT = 100


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

    Two parallel measurements are recorded for every bucket:

      Entry-level fields (``reassigned``, ``reassigned_ipv4``, ...)
      count distinct prefix records in the trie diff. Cheap to
      compute, but treats a single /8 reassignment as one unit of
      drift even though the same unit covers 16M IPs. Kept for
      backwards compatibility and as a debug view.

      Coverage fields (``reassigned_ipv4_addresses``,
      ``reassigned_ipv6_addresses``, ...) weight every changed
      prefix by the size of the address space it covers. This is
      the metric the frontend surfaces as the headline drift
      number, because it answers "how much of the IPv4 / IPv6
      address space had its ASN assignment change?" rather than
      "how many trie leaves moved?". The per-family split matters
      for Bitcoin Core peer diversity, which treats v4 and v6 as
      independent diversity dimensions.

      The two views can diverge by an order of magnitude: many
      small IPv6 reassignments inflate the entry count while
      moving very little address space, and a single large IPv4
      reassignment can dominate coverage while contributing one
      entry.

      A note on integer width: IPv6 coverage figures routinely
      exceed 2**53 (a single /32 is ~7.9e28 addresses). Python
      emits them exactly, but JSON consumers that parse numbers
      into IEEE-754 doubles — JavaScript among them — round to a
      relative error of ~1e-16. That is deliberate and harmless:
      every consumer quantises these figures to /32 NetGroup
      blocks before display, and an absolute error of ~1e18
      addresses vanishes under a 2**96-per-block divisor. Exact
      integer round-tripping through JSON is not promised.

    Top movers are ranked in all three currencies (entries, IPv4
    addresses, IPv6 addresses) but each row only carries the fields
    the frontend renders:

      ``changes``
          Entry-level total (gained + lost trie leaves, both
          families). Surfaces in the row hover tooltip as "prefix
          entries changed"; the per-direction entry counts and the
          entry-level counterpart used to ride along but were
          never rendered, so they are not emitted any more.
      ``ipv4_addresses_changed`` / ``_gained`` / ``_lost``
          Entry counts weighted by IPv4 prefix size.
      ``ipv6_addresses_changed`` / ``_gained`` / ``_lost``
          The same for IPv6.
      ``ipv4_primary_counterpart`` / ``ipv6_primary_counterpart``
          The single AS most address space was exchanged with under
          that family. Picked from whichever direction (gain vs
          loss) contributed more under the same family, so the
          arrow rendered in the Top Movers table never points at an
          arbitrary 0.
      ``ipv4_addresses_in_a`` / ``ipv4_addresses_in_b``
      ``ipv6_addresses_in_a`` / ``ipv6_addresses_in_b``
          Per-AS coverage on either side. Denominator for the
          "Touched" multiplier in the IPv4 / IPv6 Top Movers view.

    The top_movers row set is the union of the top-``TOP_MOVERS_LIMIT``
    ASes under each of the three currencies. This keeps every AS
    that would rank in the user-visible table reachable regardless
    of which currency the frontend picker selects, without the
    payload blowing up: the three rankings overlap heavily on real
    diffs, and ASes that fail to rank under any currency contribute
    no information at the top-movers tier.

    When ``addrs_file`` is given it is read line by line as one IP per
    line (blank lines and lines starting with '#' are skipped) and a
    bitcoin_node_impact section is included that counts how many of
    those IPs would resolve to a different ASN under map_b vs map_a.

    Returns a dict with these keys (entry-level first, coverage second,
    roster third, top movers, optional node impact). The per-map entry
    counts are not repeated here: the frontend reads them off the maps[]
    profiles, which are keyed by the same build names as ``from`` /
    ``to``.
        total_changes:                 int, sum of the three buckets.
        reassigned:                    int.
        reassigned_ipv4:               int, IPv4 share of ``reassigned``.
        reassigned_ipv6:               int, IPv6 share of ``reassigned``.
        newly_mapped:                  int.
        newly_mapped_ipv4:             int.
        newly_mapped_ipv6:             int.
        unmapped:                      int.
        unmapped_ipv4:                 int.
        unmapped_ipv6:                 int.
        ipv4_address_space_a:          int, total IPv4 addresses
                                       mapped in map_a (asn != 0).
        ipv4_address_space_b:          int, same for map_b.
        ipv4_bucket_space_a:           int, distinct /16 NetGroup
                                       buckets covered by map_a.
                                       Denominator of the diff
                                       explorer match banner on
                                       the IPv4 side.
        ipv4_bucket_space_b:           int, same for map_b.
        ipv4_buckets_changed:          int, distinct /16 NetGroup
                                       buckets that carry at least
                                       one changed prefix between
                                       map_a and map_b.
        ipv6_address_space_a:          int, total IPv6 addresses
                                       mapped in map_a (asn != 0).
        ipv6_address_space_b:          int, same for map_b.
        reassigned_ipv4_addresses:     int, IPv4 addresses whose ASN
                                       changed between maps.
        reassigned_ipv6_addresses:     int, same for IPv6.
        newly_mapped_ipv4_addresses:   int, IPv4 addresses that gained
                                       an ASN (sentinel 0 -> real ASN).
        newly_mapped_ipv6_addresses:   int, same for IPv6.
        unmapped_ipv4_addresses:       int, IPv4 addresses that lost
                                       their ASN (real ASN -> 0).
        unmapped_ipv6_addresses:       int, same for IPv6.
        ipv4_addresses_changed:        int, sum of the three IPv4
                                       coverage buckets above.
        ipv6_addresses_changed:        int, same for IPv6.
        as_total_a:                    int, number of distinct ASes
                                       that hold at least one prefix
                                       in map_a.
        as_total_b:                    int, same for map_b.
        as_appeared:                   int, count of ASes present in
                                       map_b but not in map_a. Peer-
                                       diversity signal: new ASes are
                                       new potential buckets for
                                       Bitcoin Core peer selection.
        as_disappeared:                int, count of ASes present in
                                       map_a but not in map_b.
        top_movers:                    list of per-AS rows; see field
                                       breakdown above.
        bitcoin_node_impact:           optional dict, present only
                                       when addrs_file is set.
    """
    asmap_a = loaded_a.asmap
    asmap_b = loaded_b.asmap

    buckets = _DiffBuckets()
    activity = _PerAsActivity()
    # ``changed_ipv4_buckets`` tracks every /16 NetGroup bucket
    # touched by an IPv4 prefix change. ``len(...)`` becomes the
    # IPv4 numerator in the diff explorer match banner — distinct
    # peer-diversity buckets that carry a changed prefix.
    changed_ipv4_buckets: set[int] = set()
    for prefix, old_asn, new_asn in asmap_a.diff(asmap_b):
        if old_asn == new_asn:
            continue
        is_v4 = is_ipv4_prefix(prefix)
        addresses = prefix_address_count(prefix)
        buckets.record(old_asn, new_asn, is_v4, addresses)
        activity.record(old_asn, new_asn, is_v4, addresses)
        if is_v4:
            changed_ipv4_buckets.update(ipv4_bucket_indices(prefix))

    ranked_asns = activity.ranked_asns(TOP_MOVERS_LIMIT)
    top_movers = [activity.row(asn, loaded_a, loaded_b) for asn in ranked_asns]

    # AS roster delta. ``entries_per_asn`` keys are exactly the
    # ASNs with at least one non-zero leaf in each map, which is
    # the right population for the "Bitcoin Core peer-bucket count"
    # signal (ASN 0 is not a real AS).
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
        "ipv4_address_space_a": loaded_a.ipv4_address_space,
        "ipv4_address_space_b": loaded_b.ipv4_address_space,
        "ipv4_bucket_space_a": loaded_a.ipv4_bucket_space,
        "ipv4_bucket_space_b": loaded_b.ipv4_bucket_space,
        "ipv4_buckets_changed": len(changed_ipv4_buckets),
        "ipv6_address_space_a": loaded_a.ipv6_address_space,
        "ipv6_address_space_b": loaded_b.ipv6_address_space,
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
    """Mutable accumulator for the three change buckets, by family.

    Local to this module: the diff loop is the only producer, the
    enclosing function is the only consumer. Pulling the running
    totals out of the main function body shrinks ``diff_loaded_maps``
    enough that the per-prefix loop reads as a single intent
    ("classify and record"), not a bookkeeping ladder.
    """

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
        if old_asn == 0:
            self.newly_mapped += 1
            if is_v4:
                self.newly_mapped_ipv4 += 1
                self.newly_mapped_ipv4_addresses += addresses
            else:
                self.newly_mapped_ipv6_addresses += addresses
        elif new_asn == 0:
            self.unmapped += 1
            if is_v4:
                self.unmapped_ipv4 += 1
                self.unmapped_ipv4_addresses += addresses
            else:
                self.unmapped_ipv6_addresses += addresses
        else:
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
    """Per-AS gained / lost counters in all three currencies.

    Keeping the three currencies side by side here (instead of as
    independent Counters scattered across the main function) means
    the top-N union pass and the row builder both read from one
    consistent source. Each ``record`` call increments exactly the
    counters relevant to one diff entry; the unit picker in the
    frontend later selects which set the user sees.
    """

    def __init__(self) -> None:
        # Entry-level counters only feed the row's combined
        # ``changes`` figure and the entries leg of the top-N union
        # ranking; per-direction entry fields are not emitted, so no
        # entry-level counterpart map is kept.
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
        """Return the union of the top ``limit`` ASes under each currency.

        Ordering: entries-rank first, then v4-only newcomers, then
        v6-only newcomers. The frontend sorts client-side per the
        active currency, so this order is only the default rendering
        when no sort is applied. Stable insertion via dict-from-keys
        preserves the entries-first tie-breaker, which keeps the
        legacy view byte-stable while the new fields ride alongside.
        """
        ordered: dict[int, None] = {}
        for asn, count in self._total(
            self._gained_entries, self._lost_entries
        ).most_common(limit):
            if count > 0:
                ordered[asn] = None
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

        Lost is folded in first so that, on a tie, the losing AS
        ranks ahead of the gaining one. This keeps the rendered
        Top Movers order stable across the entries / IPv4 / IPv6
        currencies: the AS that gave up the prefixes is the more
        natural "headline" of a reassignment event, and surfacing
        it first matches what every prior frontend release showed.
        Counter+Counter would also drop zero rows, which we need
        to keep for the union-top-N pass to see every active AS.
        """
        combined: Counter[int] = Counter()
        for asn, count in lost.items():
            combined[asn] += count
        for asn, count in gained.items():
            combined[asn] += count
        return combined

    def row(self, asn: int, loaded_a: LoadedMap, loaded_b: LoadedMap) -> dict:
        """Build one top_movers row for ``asn``.

        The per-AS presence figures (``*_in_a`` / ``*_in_b``) come
        straight from the loader caches, so the diff never re-walks
        a trie to size the "Touched" denominator.
        """
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
    """Return the single AS this row most frequently exchanged with.

    The direction with the larger total (gained vs lost) wins so
    the rendered arrow points at the real source / destination
    rather than at an arbitrary 0 when one side is empty. Ties
    favour the gain side: a row that gained and lost equally is
    more naturally described by "where did it come from?".
    """
    if gained >= lost and gained_from:
        return gained_from.most_common(1)[0][0]
    if lost_to:
        return lost_to.most_common(1)[0][0]
    return 0


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
