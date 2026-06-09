"""Network-tap metrics: observed nodes scored against the ASmap history.

Five metrics, all derived from the same normalised ``Snapshot`` stream so
a reviewer can trace every number back to a public input:

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

Source-agnostic: the functions here only ever touch ``Snapshot`` /
``Node`` plus the loaded ``ASMap`` objects, so KIT, Bitnodes, or a future
crawler all flow through the same code and produce comparable series.
"""

from __future__ import annotations

import bisect
import ipaddress
from collections import Counter
from dataclasses import dataclass

from asmap_dashboard._vendor.asmap import ASMap, net_to_prefix
from asmap_dashboard.loader import LoadedMap
from asmap_dashboard.netgroup import default_netgroup, linked_ipv4
from asmap_dashboard.network.snapshots import Node, Snapshot

TOP_ASES_LIMIT = 15

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


def _snapshot_metrics(snapshot: Snapshot, build: _Build) -> dict:
    """Score one snapshot's nodes against the build in effect at its time.

    The emitted dict only carries the fields the frontend renders
    (overview cards, HHI / operators series, cross-check table).
    Per-family node splits, skip diagnostics, and the matched-build
    echo used to ride along but were never consumed; they can be
    re-derived from the raw snapshots if a future view needs them.
    """
    prepared = _prepare_nodes(snapshot.nodes)

    asn_counts: Counter[int] = Counter()
    unmapped = 0
    # Two bucket vocabularies over the identical node set: what Core
    # buckets into with this asmap loaded vs. with no asmap at all.
    asmap_buckets: set[object] = set()
    default_buckets: set[object] = set()
    # Cross-check accumulators (only nodes the crawler annotated count).
    cross_compared = 0
    cross_agree = 0
    annotated = 0

    for node in prepared:
        asn = _lookup_asn(build.asmap, node.prefix)
        default_group = default_netgroup(node.ip)
        default_buckets.add(default_group)
        if asn:
            asn_counts[asn] += 1
            asmap_buckets.add(("as", asn))
        else:
            unmapped += 1
            # Core falls back to the default group for unmapped peers,
            # so the honest ASmap-bucket count includes that fallback.
            asmap_buckets.add(("net", default_group))

        if node.asn is not None:
            annotated += 1
            if asn:
                cross_compared += 1
                if node.asn == asn:
                    cross_agree += 1

    clearnet = len(prepared)
    mapped = clearnet - unmapped

    return {
        "source": snapshot.source,
        "label": snapshot.label,
        "timestamp": snapshot.timestamp,
        "nodes_clearnet": clearnet,
        "unique_asns": len(asn_counts),
        "hhi": round(_hhi(asn_counts), 6),
        "top_ases": _top_ases(asn_counts, mapped),
        "bucketing": {
            "default_groups": len(default_buckets),
            "asmap_groups": len(asmap_buckets),
            "reduction_ratio": _ratio(len(default_buckets), len(asmap_buckets)),
        },
        "cross_check": _cross_check(cross_compared, cross_agree, annotated, clearnet),
    }


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

    if not sources_out:
        return {}

    return {
        "reference_timestamp": reference.timestamp,
        "sources": sources_out,
    }


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
