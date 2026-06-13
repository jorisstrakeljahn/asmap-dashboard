"""Network-tap metrics: observed nodes scored against the ASmap history.

Seven metrics, all derived from the same normalised ``Snapshot`` stream
so a reviewer can trace every number back to a public input:

  1. Map staleness / decay
     For one fixed node set (a source's most recent snapshot), look every
     node up in *every* published build and count how many resolve to a
     different ASN than they do under the newest build. Plotted against
     build age this is the "how stale is an N-day-old embedded map for
     today's network?" curve — the direct answer to whether Bitcoin Core
     should ship a fresher asmap. The node set is held fixed on purpose:
     comparing different populations is what makes a naive churn series
     look non-monotonic.

  2. AS concentration (HHI)
     Bucket each snapshot's nodes by the ASN the *in-effect* build
     resolves, then compute the Herfindahl-Hirschman index over those
     buckets. Low HHI = peers spread across many ASes = healthier peer
     diversity.

  3. Bucketing effectiveness
     Count the distinct peer-diversity buckets the same node set falls
     into under ASmap (Core's GetGroup with an asmap loaded: the ASN, or
     the default group when unmapped) versus under Core's default /16-/32
     bucketing. ASmap *consolidates* many prefix buckets into fewer AS
     buckets — the reduction ratio is the security-relevant number, not a
     raw "more is better" count.

  4. NetGroup diversity over time
     The ASmap-bucket count from metric 3, surfaced as its own time
     series so the trend (are nodes spreading across more ASes over
     time?) is readable without re-deriving it.

  5. ASN attribution cross-check
     For nodes the crawler annotated with its own whois ASN, the share
     that agrees with the ASmap lookup. A persistent gap flags either a
     stale embedded map or a crawler whois source drifting from the BGP
     view ASmap is built on.

  6. ASmap coverage of observed nodes
     How many of the observed clearnet nodes the in-effect build
     resolves to a real AS at all (``mapped`` vs ``nodes_clearnet``).
     The most direct "does the map fit the real network?" reading:
     a coverage share that sinks over time means kartograf's input
     data is falling behind the network, independent of how the
     mapped majority is distributed.

  7. AS Nakamoto coefficient
     The minimum number of autonomous systems that together hold at
     least half of the mapped nodes. Where HHI summarises the whole
     distribution, this answers the blunt adversarial question "how
     many ASes would an attacker have to control to sit next to 50 %
     of the network?" — higher is healthier. Computed over mapped
     nodes, consistent with the HHI denominator.

Every per-snapshot metric is additionally split by address family
(``families.ipv4`` / ``families.ipv6``). The family is the *effective*
one after the linked-IPv4 unwrap, so a 6to4 or NAT64 peer counts as
IPv4 exactly like Core's GetGroup() treats it. Bitcoin Core's peer
diversity logic handles the two families as independent dimensions,
so a combined number can mask one family concentrating while the
other improves.

Source-agnostic: the functions here only ever touch ``Snapshot`` /
``Node`` plus the loaded ``ASMap`` objects, so KIT, Bitnodes, or a future
crawler all flow through the same code and produce comparable series.
"""

from __future__ import annotations

import bisect
import ipaddress
import itertools
from collections import Counter
from dataclasses import dataclass

from asmap_dashboard._prefix import is_ipv4_prefix
from asmap_dashboard._vendor.asmap import ASMap, net_to_prefix
from asmap_dashboard.loader import LoadedMap
from asmap_dashboard.netgroup import default_netgroup, linked_ipv4
from asmap_dashboard.network.snapshots import Node, Snapshot

TOP_ASES_LIMIT = 15

# Which source's most recent snapshot is the node set the impact
# numbers are scored over. KIT first because it is the live, fully
# annotated crawl; the frontend treats it as primary too
# (series-data.js SOURCE_ORDER), so the dashboard card / diff banner
# and this payload agree on whose nodes were counted.
PRIMARY_SOURCE_ORDER = ("kit", "bitnodes")

# A snapshot only feeds the cross-check view when enough of its nodes
# carry the crawler annotation; below this the sample is too thin to
# be worth a (misleading) number. Expressed as a share of clearnet
# nodes so it scales with snapshot size.
ANNOTATION_COVERAGE_FLOOR = 0.5

SECONDS_PER_DAY = 86_400


@dataclass(frozen=True)
class _Build:
    """The minimum a metric needs about one published build.

    Decouples the network metrics from the discovery dataclass in
    ``metrics.py`` so this module can be unit-tested with hand-built
    ASMaps and never imports the year-folder discovery machinery.
    """

    name: str
    timestamp: int
    asmap: ASMap


def _ip_to_prefix(ip: str) -> list[bool]:
    """Return the full-length bit prefix ``ASMap.lookup`` expects.

    An IPv6 address that merely transports an IPv4 host (6to4,
    Teredo, NAT64, ...) is looked up as that IPv4 — Core's
    ``GetMappedAS()`` does the same, so a tunneled peer scores
    against the same map entry as its native twin. The crawls
    really carry such peers (a handful of 6to4 and NAT64 nodes
    per KIT snapshot), so this is not a theoretical branch.

    A /32 (v4) or /128 (v6) single-host network is the lookup key
    for one node.
    """
    addr = ipaddress.ip_address(ip)
    if isinstance(addr, ipaddress.IPv6Address):
        addr = linked_ipv4(addr) or addr
    if isinstance(addr, ipaddress.IPv4Address):
        return net_to_prefix(ipaddress.IPv4Network((int(addr), 32)))
    return net_to_prefix(ipaddress.IPv6Network(f"{addr}/128"))


def _lookup_asn(asmap: ASMap, prefix: list[bool]) -> int:
    """ASN for a prefix, with the lookup's None/0 sentinels folded to 0.

    ``ASMap.lookup`` returns ``None`` for an indeterminate prefix and
    ``0`` for an explicitly-unassigned one; both mean "no AS opinion" for
    every metric here, so they collapse to 0.
    """
    return asmap.lookup(prefix) or 0


@dataclass(frozen=True)
class _PreparedNode:
    """A snapshot node with its lookup prefix precomputed once.

    The decay curve looks the same node set up against ~16 builds, so
    converting the address to a bit prefix once (instead of per build)
    keeps that pass at one ``net_to_prefix`` per node rather than per
    (node, build) pair.
    """

    prefix: list[bool]
    asn: int | None
    ip: str


def _prepare_nodes(nodes: tuple[Node, ...]) -> list[_PreparedNode]:
    prepared: list[_PreparedNode] = []
    for node in nodes:
        try:
            prefix = _ip_to_prefix(node.ip)
        except ValueError:
            continue
        prepared.append(
            _PreparedNode(
                prefix=prefix,
                asn=node.asn,
                ip=node.ip,
            )
        )
    return prepared


def _select_in_effect_build(builds: list[_Build], timestamp: int) -> _Build:
    """Return the build a node operator would have embedded at ``timestamp``.

    That is the most recent build whose release is at or before the
    snapshot. Snapshots older than the first build fall back to that
    first build, since there is nothing earlier to compare against.
    The fallback fires in the real history: the KIT dossier of
    2024-01-05 12:55 UTC sits about an hour before the first build's
    14:00 UTC file timestamp. Scoring it against that build is the
    right call — the build represents that day's routing data, and
    the alternative (dropping the snapshot) would discard a full
    crawl over a file-metadata artefact.
    ``builds`` is assumed sorted by timestamp (the caller guarantees it).
    """
    times = [b.timestamp for b in builds]
    idx = bisect.bisect_right(times, timestamp) - 1
    if idx < 0:
        idx = 0
    return builds[idx]


def _hhi(counts: Counter[int]) -> float:
    """Herfindahl-Hirschman index over a count distribution, in [0, 1].

    1.0 means every node is in one AS (worst case for peer diversity),
    values near 0 mean nodes spread evenly across many ASes.
    """
    total = sum(counts.values())
    if total == 0:
        return 0.0
    return sum((count / total) ** 2 for count in counts.values())


class _Tally:
    """Accumulator for one node population (the whole snapshot or one
    address family).

    Keeping the per-population arithmetic in one place means the
    overall numbers and the families split can never drift apart:
    both are fed from the identical per-node classification loop in
    ``_snapshot_metrics``.
    """

    def __init__(self) -> None:
        self.asn_counts: Counter[int] = Counter()
        self.unmapped = 0
        # Two bucket vocabularies over the identical node set: what Core
        # buckets into with this asmap loaded vs. with no asmap at all.
        self.asmap_buckets: set[object] = set()
        self.default_buckets: set[object] = set()

    def add(self, asn: int, default_group: object) -> None:
        self.default_buckets.add(default_group)
        if asn:
            self.asn_counts[asn] += 1
            self.asmap_buckets.add(("as", asn))
        else:
            self.unmapped += 1
            # Core falls back to the default group for unmapped peers,
            # so the honest ASmap-bucket count includes that fallback.
            self.asmap_buckets.add(("net", default_group))

    @property
    def clearnet(self) -> int:
        return self.mapped + self.unmapped

    @property
    def mapped(self) -> int:
        return sum(self.asn_counts.values())

    def bucketing(self) -> dict:
        return {
            "default_groups": len(self.default_buckets),
            "asmap_groups": len(self.asmap_buckets),
            "reduction_ratio": _ratio(
                len(self.default_buckets), len(self.asmap_buckets)
            ),
        }


def _snapshot_metrics(snapshot: Snapshot, build: _Build) -> dict:
    """Score one snapshot's nodes against the build in effect at its time.

    The emitted dict only carries the fields the frontend renders
    (overview cards, HHI / operators / coverage series, cross-check
    table). Skip diagnostics and the matched-build echo used to ride
    along but were never consumed; they can be re-derived from the
    raw snapshots if a future view needs them.

    ``families`` repeats the headline numbers per effective address
    family (after the linked-IPv4 unwrap, mirroring Core's GetGroup),
    because Core treats IPv4 and IPv6 as independent peer-diversity
    dimensions and a combined HHI can mask one family concentrating
    while the other improves.
    """
    prepared = _prepare_nodes(snapshot.nodes)

    overall = _Tally()
    families = {"ipv4": _Tally(), "ipv6": _Tally()}
    # Cross-check accumulators (only nodes the crawler annotated count).
    cross_compared = 0
    cross_agree = 0
    annotated = 0

    for node in prepared:
        asn = _lookup_asn(build.asmap, node.prefix)
        default_group = default_netgroup(node.ip)
        overall.add(asn, default_group)
        family = "ipv4" if is_ipv4_prefix(node.prefix) else "ipv6"
        families[family].add(asn, default_group)

        if node.asn is not None:
            annotated += 1
            if asn:
                cross_compared += 1
                if node.asn == asn:
                    cross_agree += 1

    return {
        "source": snapshot.source,
        "label": snapshot.label,
        "timestamp": snapshot.timestamp,
        "nodes_clearnet": overall.clearnet,
        "mapped": overall.mapped,
        "unique_asns": len(overall.asn_counts),
        "hhi": round(_hhi(overall.asn_counts), 6),
        "nakamoto_50": _nakamoto_coefficient(overall.asn_counts),
        "top_ases": _top_ases(overall.asn_counts, overall.mapped),
        "bucketing": overall.bucketing(),
        "families": {name: _family_payload(tally) for name, tally in families.items()},
        "cross_check": _cross_check(
            cross_compared, cross_agree, annotated, overall.clearnet
        ),
    }


def _family_payload(tally: _Tally) -> dict:
    """The per-family slice of the snapshot metrics.

    Same vocabulary as the top level (nodes, mapped, HHI, bucketing)
    so the frontend's family toggle can swap accessors without
    reshaping anything. A family with zero observed nodes still
    emits the full dict — the schema stays rectangular and the
    frontend never defends against missing keys.
    """
    return {
        "nodes": tally.clearnet,
        "mapped": tally.mapped,
        "unique_asns": len(tally.asn_counts),
        "hhi": round(_hhi(tally.asn_counts), 6),
        "bucketing": tally.bucketing(),
    }


def _nakamoto_coefficient(
    asn_counts: Counter[int], threshold: float = 0.5
) -> int | None:
    """Minimum number of ASes that together hold >= ``threshold`` of
    the mapped nodes.

    The blunt adversarial reading of the AS distribution: an attacker
    controlling that many networks sits next to half the (mapped)
    listening nodes. Returns ``None`` when nothing is mapped, so the
    frontend can show an explicit no-data state instead of a fake 0.
    """
    total = sum(asn_counts.values())
    if total == 0:
        return None
    needed = total * threshold
    cumulative = 0
    for rank, (_asn, count) in enumerate(asn_counts.most_common(), start=1):
        cumulative += count
        if cumulative >= needed:
            return rank
    return len(asn_counts)


def _top_ases(asn_counts: Counter[int], mapped: int) -> list[dict]:
    """Top ASes by observed node count, with each AS's node share."""
    return [
        {
            "asn": asn,
            "nodes": count,
            "share": round(count / mapped, 6) if mapped else 0.0,
        }
        for asn, count in asn_counts.most_common(TOP_ASES_LIMIT)
    ]


def _cross_check(
    compared: int, agree: int, annotated: int, clearnet: int
) -> dict | None:
    """Crawler-whois vs ASmap agreement, or None when coverage is too thin.

    Returns ``None`` (so the frontend hides the panel) when fewer than
    ``ANNOTATION_COVERAGE_FLOOR`` of clearnet nodes carry a crawler ASN,
    e.g. Bitnodes' compact snapshots that ship no whois at all.
    """
    if clearnet == 0 or annotated / clearnet < ANNOTATION_COVERAGE_FLOOR:
        return None
    return {
        "compared": compared,
        "agree": agree,
        "agreement_pct": round(100 * agree / compared, 4) if compared else 0.0,
    }


def _decay_curve(snapshot: Snapshot, builds: list[_Build], reference: _Build) -> dict:
    """Drift of a fixed node set across every build, vs the newest build.

    For each build B, ``drift_pct`` is the share of nodes — among those
    the reference build maps to a real AS — that resolve to a *different*
    AS under B. Held against build age (reference release minus B's
    release) this is the decay curve. The node set is the snapshot's,
    held fixed across all points so the series reflects map age alone,
    not a changing population.
    """
    prepared = _prepare_nodes(snapshot.nodes)
    reference_asns = [_lookup_asn(reference.asmap, n.prefix) for n in prepared]
    mapped_idx = [i for i, asn in enumerate(reference_asns) if asn]

    points: list[dict] = []
    for build in builds:
        differ = 0
        for i in mapped_idx:
            if _lookup_asn(build.asmap, prepared[i].prefix) != reference_asns[i]:
                differ += 1
        denom = len(mapped_idx)
        points.append(
            {
                "build": build.name,
                "build_timestamp": build.timestamp,
                "age_days": _age_days(build.timestamp, reference.timestamp),
                "drift_pct": round(100 * differ / denom, 4) if denom else 0.0,
            }
        )
    return {
        "node_set_label": snapshot.label,
        "node_set_size": len(mapped_idx),
        "reference_build": reference.name,
        "reference_timestamp": reference.timestamp,
        "points": points,
    }


def _classify_change(asn_a: int, asn_b: int) -> str | None:
    """Bucket one node's ASN change between two maps.

    Mirrors ``diff._node_impact``: same three categories the Diff
    Explorer uses for prefixes, here over observed nodes. ``0`` is the
    folded "no AS opinion" sentinel from ``_lookup_asn``.
    """
    if asn_a == asn_b:
        return None
    if asn_a == 0:
        return "newly_mapped"
    if asn_b == 0:
        return "unmapped"
    return "reassigned"


def _impact_dict(families: list[str], asns_a: list[int], asns_b: list[int]) -> dict:
    """Count how the node set's ASNs move from map A to map B.

    ``families`` / ``asns_a`` / ``asns_b`` are aligned per-node lists.
    Returns total + per-category counts overall and split by effective
    address family, so a consumer can scope to the family it shows
    (the Diff Explorer) or read the whole set (the Network card).
    """

    def blank() -> dict:
        return {
            "total_nodes": 0,
            "reassigned": 0,
            "newly_mapped": 0,
            "unmapped": 0,
        }

    overall = blank()
    fam = {"ipv4": blank(), "ipv6": blank()}
    for family, asn_a, asn_b in zip(families, asns_a, asns_b, strict=True):
        overall["total_nodes"] += 1
        fam[family]["total_nodes"] += 1
        change = _classify_change(asn_a, asn_b)
        if change is not None:
            overall[change] += 1
            fam[family][change] += 1

    def finalize(d: dict) -> dict:
        d["total_affected"] = d["reassigned"] + d["newly_mapped"] + d["unmapped"]
        return d

    result = finalize(overall)
    result["families"] = {name: finalize(t) for name, t in fam.items()}
    return result


def _build_node_impact(
    snapshot: Snapshot, diffable_builds: list[_Build]
) -> tuple[dict | None, dict]:
    """Score one node set against every diffable build pair.

    Each node's ASN is looked up once per build (``net_to_prefix`` is
    precomputed by ``_prepare_nodes``), then every pair is a cheap
    integer comparison over those vectors — so this stays affordable
    even though the pair count is the same O(N^2) all-pairs set the
    Diff Explorer carries.

    Returns ``(latest_update, pair_impact)``:

      - ``latest_update`` is the impact of the two most recent diffable
        builds — "did the last release move the observed network?" —
        or ``None`` when fewer than two diffable builds exist.
      - ``pair_impact`` carries one entry per (from, to) build pair,
        keyed ``"<from>|<to>"`` to match the Diff Explorer's diff keys,
        so the explorer can join a node-impact banner onto any pair.
    """
    prepared = _prepare_nodes(snapshot.nodes)
    families = ["ipv4" if is_ipv4_prefix(n.prefix) else "ipv6" for n in prepared]
    asn_by_build = {
        build.name: [_lookup_asn(build.asmap, n.prefix) for n in prepared]
        for build in diffable_builds
    }

    pairs: dict[str, dict] = {}
    for build_a, build_b in itertools.combinations(diffable_builds, 2):
        pairs[f"{build_a.name}|{build_b.name}"] = _impact_dict(
            families, asn_by_build[build_a.name], asn_by_build[build_b.name]
        )

    latest_update: dict | None = None
    if len(diffable_builds) >= 2:
        prev_build, last_build = diffable_builds[-2], diffable_builds[-1]
        latest_update = {
            "from_build": prev_build.name,
            "to_build": last_build.name,
            "from_timestamp": prev_build.timestamp,
            "to_timestamp": last_build.timestamp,
            **_impact_dict(
                families,
                asn_by_build[prev_build.name],
                asn_by_build[last_build.name],
            ),
        }

    return latest_update, {"pairs": pairs}


def _diffable_builds(builds: list, loaded: dict) -> list[_Build]:
    """The builds the Diff Explorer can pair: those with an unfilled
    variant, lifted into ``_Build`` and sorted by timestamp.

    The diff pipeline only emits unfilled-vs-unfilled diffs, so scoring
    node impact over the same set keeps the ``"<from>|<to>"`` keys here
    in lockstep with the diff keys the frontend looks up.
    """
    out: list[_Build] = []
    for build in builds:
        if build.unfilled_path is None:
            continue
        loaded_map: LoadedMap = loaded[build.unfilled_path]
        out.append(
            _Build(name=build.name, timestamp=build.timestamp, asmap=loaded_map.asmap)
        )
    out.sort(key=lambda b: b.timestamp)
    return out


def build_network_section(
    builds: list,
    loaded: dict,
    snapshots_by_source: dict[str, list[Snapshot]],
) -> dict:
    """Assemble the ``network`` payload from snapshots and loaded builds.

    ``builds`` is the ``DiscoveredBuild`` list from ``metrics.discover_maps``
    and ``loaded`` the path -> ``LoadedMap`` cache, so this reuses the
    maps the Maps/Diff pipeline already parsed instead of re-reading any
    .dat file. Each source contributes a per-snapshot time series plus
    one decay curve anchored on its most recent snapshot.

    Returns ``{}`` when there are no builds or no snapshots, which keeps
    the caller's "omit the key entirely" contract simple.
    """
    prepared_builds = _prepare_builds(builds, loaded)
    if not prepared_builds:
        return {}
    reference = prepared_builds[-1]

    sources_out: dict[str, dict] = {}
    latest_snapshot_by_source: dict[str, Snapshot] = {}
    for source, snapshots in snapshots_by_source.items():
        usable = [s for s in snapshots if s.nodes]
        if not usable:
            continue
        series = [
            _snapshot_metrics(s, _select_in_effect_build(prepared_builds, s.timestamp))
            for s in usable
        ]
        decay = _decay_curve(usable[-1], prepared_builds, reference)
        sources_out[source] = {"snapshots": series, "decay": decay}
        latest_snapshot_by_source[source] = usable[-1]

    if not sources_out:
        return {}

    out = {
        "reference_timestamp": reference.timestamp,
        "sources": sources_out,
    }

    # Node-impact: score the primary source's most recent node set
    # against every diffable build pair. Additive and optional — the
    # frontend renders the impact card / diff banner only when these
    # keys are present, so an older committed network.json keeps
    # working unchanged.
    diffable = _diffable_builds(builds, loaded)
    primary = next(
        (s for s in PRIMARY_SOURCE_ORDER if s in latest_snapshot_by_source),
        next(iter(latest_snapshot_by_source)),
    )
    if len(diffable) >= 2:
        node_set = latest_snapshot_by_source[primary]
        latest_update, pair_impact = _build_node_impact(node_set, diffable)
        meta = {
            "node_set_source": primary,
            "node_set_label": node_set.label,
            "node_set_timestamp": node_set.timestamp,
        }
        if latest_update is not None:
            out["latest_update"] = {**meta, **latest_update}
        out["pair_impact"] = {**meta, **pair_impact}

    return out


def _prepare_builds(builds: list, loaded: dict) -> list[_Build]:
    """Lift DiscoveredBuilds into _Build, preferring the unfilled variant.

    Filled and unfilled resolve every lookup identically (filling only
    merges adjacent same-AS prefixes), so a filled-only build is still a
    valid lookup source; unfilled is preferred purely to stay consistent
    with the diff pipeline's variant choice.
    """
    out: list[_Build] = []
    for build in builds:
        path = build.unfilled_path or build.filled_path
        if path is None:
            continue
        loaded_map: LoadedMap = loaded[path]
        out.append(
            _Build(
                name=build.name,
                timestamp=build.timestamp,
                asmap=loaded_map.asmap,
            )
        )
    out.sort(key=lambda b: b.timestamp)
    return out


def _age_days(build_ts: int, reference_ts: int) -> int:
    """Whole days ``build_ts`` predates ``reference_ts`` (never negative)."""
    return max(0, (reference_ts - build_ts) // SECONDS_PER_DAY)


def _ratio(numerator: int, denominator: int) -> float:
    return round(numerator / denominator, 4) if denominator else 0.0
