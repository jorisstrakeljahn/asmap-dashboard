"""Network-tap metrics: observed nodes scored against the ASmap history.

The seven metrics and what each answers are catalogued in
``docs/architecture.md`` ("The seven network-tap metrics"); the per-node
arithmetic lives in the leaf functions below. All of them consume the
same normalised ``Snapshot`` stream, so KIT, Bitnodes, or a future
crawler flow through identical code and produce comparable series.

Every per-snapshot metric is also split by *effective* address family
(after the linked-IPv4 unwrap, so a 6to4/NAT64 peer counts as IPv4 like
Core's GetGroup does). Core treats the two families as independent peer
-diversity dimensions, so a combined number can hide one family
concentrating while the other improves.
"""

from __future__ import annotations

import bisect
import ipaddress
import itertools
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from asmap_dashboard._prefix import classify_asn_change, ip_to_prefix, is_ipv4_prefix
from asmap_dashboard._vendor.asmap import ASMap
from asmap_dashboard.netgroup import default_netgroup
from asmap_dashboard.network.snapshots import Node, Snapshot

TOP_ASES_LIMIT = 15

# Preferred node set for the all-pairs node-impact pass. Mirrors the
# frontend's series-data.js SOURCE_ORDER so card and payload count the
# same nodes; KIT first because it is the live, fully annotated crawl.
PRIMARY_SOURCE_ORDER = ("kit", "bitnodes", "bitmex")

# Minimum share of clearnet nodes that must carry a crawler ASN before
# the cross-check is shown; below it the sample is too thin to trust.
ANNOTATION_COVERAGE_FLOOR = 0.5

SECONDS_PER_DAY = 86_400

# A build is stamped a few hours after the same-day crawl with the same
# routing data, so widen the "build at or before the snapshot" rule by one
# day. A crawl then pairs with its own same-day build, not the previous
# release, while staying well below the multi-week release cadence.
IN_EFFECT_TOLERANCE_SECONDS = SECONDS_PER_DAY


@dataclass(frozen=True)
class _Build:
    """One published build, decoupled from ``metrics.DiscoveredBuild`` so
    this module unit-tests with hand-built ASMaps."""

    name: str
    timestamp: int
    asmap: ASMap


def _node_ip_to_prefix(ip: str) -> list[bool]:
    """Lookup prefix for a node's IP, via the shared ``ip_to_prefix`` so
    crawl data and the diff ``--addrs`` path share one linked-IPv4 unwrap."""
    return ip_to_prefix(ipaddress.ip_address(ip))


def _lookup_asn(asmap: ASMap, prefix: list[bool]) -> int:
    """ASN for a prefix, folding lookup's None/0 sentinels (both "no AS
    opinion") to 0."""
    return asmap.lookup(prefix) or 0


@dataclass(frozen=True)
class _PreparedNode:
    """A snapshot node with its lookup prefix precomputed once, so the
    decay curve's ~16-build pass converts each address once, not per build."""

    prefix: list[bool]
    asn: int | None
    ip: str


# A per-node drift target: given a prepared node and its ASN under the
# reference build, the AS it should resolve to, or None to drop the node.
TargetFn = Callable[[_PreparedNode, int], int | None]


def _prepare_nodes(nodes: tuple[Node, ...]) -> list[_PreparedNode]:
    prepared: list[_PreparedNode] = []
    for node in nodes:
        try:
            prefix = _node_ip_to_prefix(node.ip)
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

    That is the most recent build released at or before the snapshot,
    widened by ``IN_EFFECT_TOLERANCE_SECONDS`` (see that constant) so a
    crawl pairs with its own same-day build rather than the previous one.
    Snapshots older than every build fall back to the earliest, since
    there is nothing earlier to compare against. ``builds`` is assumed
    sorted by timestamp (the caller guarantees it).
    """
    times = [b.timestamp for b in builds]
    idx = bisect.bisect_right(times, timestamp + IN_EFFECT_TOLERANCE_SECONDS) - 1
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
    """Accumulator for one node population (whole snapshot or one family).

    Overall and per-family numbers share this one classifier so they can
    never drift apart.
    """

    def __init__(self) -> None:
        self.asn_counts: Counter[int] = Counter()
        self.unmapped = 0
        # The same node set bucketed two ways: with this asmap loaded vs.
        # with no asmap at all.
        self.asmap_buckets: set[object] = set()
        self.default_buckets: set[object] = set()

    def add(self, asn: int, default_group: object) -> None:
        self.default_buckets.add(default_group)
        if asn:
            self.asn_counts[asn] += 1
            self.asmap_buckets.add(("as", asn))
        else:
            self.unmapped += 1
            # Core buckets unmapped peers by the default group, so the
            # honest ASmap-bucket count includes that fallback.
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

    Emits only the fields the frontend renders, plus the in-effect build
    (name + timestamp) so the overview caption can name the map the
    numbers are scored against. ``families`` repeats the headline numbers
    per effective address family (see the module docstring for why).
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
        # The in-effect build every number here is scored against; the
        # overview caption surfaces its date.
        "build": {"name": build.name, "timestamp": build.timestamp},
        "nodes_clearnet": overall.clearnet,
        "mapped": overall.mapped,
        "unique_asns": len(overall.asn_counts),
        "hhi": round(_hhi(overall.asn_counts), 6),
        "ases_to_50pct": _ases_to_reach_share(overall.asn_counts),
        "top_ases": _top_ases(overall.asn_counts, overall.mapped),
        "bucketing": overall.bucketing(),
        "families": {name: _family_payload(tally) for name, tally in families.items()},
        "cross_check": _cross_check(
            cross_compared, cross_agree, annotated, overall.clearnet
        ),
    }


def _family_payload(tally: _Tally) -> dict:
    """The per-family slice, same shape as the top level so the frontend's
    family toggle swaps accessors without reshaping. A zero-node family
    still emits the full dict, keeping the schema rectangular."""
    return {
        "nodes": tally.clearnet,
        "mapped": tally.mapped,
        "unique_asns": len(tally.asn_counts),
        "hhi": round(_hhi(tally.asn_counts), 6),
        "bucketing": tally.bucketing(),
    }


def _ases_to_reach_share(
    asn_counts: Counter[int], threshold: float = 0.5
) -> int | None:
    """Minimum number of ASes that together hold >= ``threshold`` of the
    mapped nodes (the "ASes to reach 50%" card at the default 0.5).

    Returns ``None`` when nothing is mapped, so the frontend shows a
    no-data state instead of a fake 0.
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
    """Crawler-whois vs ASmap agreement, or None when fewer than
    ``ANNOTATION_COVERAGE_FLOOR`` of clearnet nodes carry a crawler ASN
    (e.g. compact snapshots with no whois), so the frontend hides the panel."""
    if clearnet == 0 or annotated / clearnet < ANNOTATION_COVERAGE_FLOOR:
        return None
    return {
        "compared": compared,
        "agree": agree,
        "agreement_pct": round(100 * agree / compared, 4) if compared else 0.0,
    }


def _map_target(node: _PreparedNode, reference_asn: int) -> int | None:
    """Map-versus-map target: the newest build's own lookup of the node,
    or ``None`` for nodes the newest build does not map (nothing to
    drift against). Drift here is divergence from the freshest map, so
    the newest build sits at 0 — the pure aging signal, defined for
    every crawler."""
    return reference_asn or None


def _truth_target(node: _PreparedNode, reference_asn: int) -> int | None:
    """Reality target: the crawler's own whois ASN, restricted to nodes
    the newest build also maps so age 0 reads as the attribution gap.
    ``None`` drops nodes without whois (or unmapped by the newest
    build), so a crawler whose anchor snapshot ships no whois yields an
    empty curve and is greyed out of the reality view."""
    return node.asn if (reference_asn and node.asn is not None) else None


def _drift_curve(
    snapshot: Snapshot,
    builds: list[_Build],
    target_reference: _Build,
    age_reference: _Build,
    target: TargetFn,
) -> dict:
    """Drift of a fixed node set across ``builds`` against a per-node target.

    ``target(node, reference_asn)`` returns the AS each node should resolve
    to — the freshest map (``_map_target``) or crawler whois
    (``_truth_target``) — or ``None`` to drop it; ``reference_asn`` is the
    lookup under ``target_reference`` (the in-effect build), restricting to
    nodes it maps so the freshest point reads as the attribution gap, not a
    coverage artefact. Per build, drift is the share of kept nodes resolving
    to a different AS than their target. ``age_days`` is measured from
    ``age_reference`` (newest build overall) so every source shares one
    age-to-calendar axis.
    """
    prepared = _prepare_nodes(snapshot.nodes)
    reference_asns = [_lookup_asn(target_reference.asmap, n.prefix) for n in prepared]
    targets = [
        target(node, ref) for node, ref in zip(prepared, reference_asns, strict=True)
    ]
    idx = [i for i, tgt in enumerate(targets) if tgt]

    points: list[dict] = []
    for build in builds:
        differ = sum(
            1 for i in idx if _lookup_asn(build.asmap, prepared[i].prefix) != targets[i]
        )
        points.append(
            {
                "build": build.name,
                "build_timestamp": build.timestamp,
                "age_days": _age_days(build.timestamp, age_reference.timestamp),
                "drift_pct": round(100 * differ / len(idx), 4) if idx else 0.0,
            }
        )
    return {
        "node_set_label": snapshot.label,
        "node_set_size": len(idx),
        "reference_build": target_reference.name,
        "reference_timestamp": target_reference.timestamp,
        "points": points,
    }


def _impact_dict(
    node_families: list[str], asns_a: list[int], asns_b: list[int]
) -> dict:
    """Count how the node set's ASNs move from map A to map B.

    ``node_families`` / ``asns_a`` / ``asns_b`` are aligned per-node
    lists. Returns total + per-category counts overall and split by
    effective address family, so a consumer can scope to the family it
    shows (the Diff Explorer) or read the whole set (the Network card).
    """

    def blank() -> dict:
        return {
            "total_nodes": 0,
            "reassigned": 0,
            "newly_mapped": 0,
            "unmapped": 0,
        }

    overall = blank()
    by_family = {"ipv4": blank(), "ipv6": blank()}
    for family, asn_a, asn_b in zip(node_families, asns_a, asns_b, strict=True):
        overall["total_nodes"] += 1
        by_family[family]["total_nodes"] += 1
        change = classify_asn_change(asn_a, asn_b)
        if change is not None:
            overall[change] += 1
            by_family[family][change] += 1

    def finalize(counts: dict) -> dict:
        counts["total_affected"] = (
            counts["reassigned"] + counts["newly_mapped"] + counts["unmapped"]
        )
        return counts

    result = finalize(overall)
    result["families"] = {name: finalize(counts) for name, counts in by_family.items()}
    return result


def _build_node_impact(snapshot: Snapshot, diffable_builds: list[_Build]) -> dict:
    """Score one node set against every diffable build pair.

    Each node's ASN is looked up once per build, then every pair is a
    cheap integer comparison over those vectors, keeping the O(N^2)
    all-pairs set affordable. Returns ``{"pairs": {...}}``, one entry per
    pair keyed ``"<from>|<to>"`` to match the Diff Explorer's diff keys.
    The two-newest-builds impact for the banner comes from the per-source
    ``_latest_update_impact`` instead.
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
    return {"pairs": pairs}


def _latest_update_impact(
    snapshot: Snapshot, diffable_builds: list[_Build]
) -> dict | None:
    """Impact of the two most recent diffable builds on one node set.

    The "latest update impact" card number for any source. ``None`` below
    two builds. Looks up only the two newest builds (not the full all-pairs
    set), so attaching it to every source stays cheap.
    """
    if len(diffable_builds) < 2:
        return None
    prev_build, last_build = diffable_builds[-2], diffable_builds[-1]
    prepared = _prepare_nodes(snapshot.nodes)
    families = ["ipv4" if is_ipv4_prefix(n.prefix) else "ipv6" for n in prepared]
    asns_prev = [_lookup_asn(prev_build.asmap, n.prefix) for n in prepared]
    asns_last = [_lookup_asn(last_build.asmap, n.prefix) for n in prepared]
    return {
        "from_build": prev_build.name,
        "to_build": last_build.name,
        "from_timestamp": prev_build.timestamp,
        "to_timestamp": last_build.timestamp,
        **_impact_dict(families, asns_prev, asns_last),
    }


def _lift_builds(
    builds: list, loaded: dict, pick_path: Callable[..., Path | None]
) -> list[_Build]:
    """Lift the builds whose ``pick_path(build)`` variant is present into
    ``_Build``, sorted by timestamp (``None`` drops the build). The variant
    rules live in the thin wrappers below so the loop stays shared."""
    out: list[_Build] = []
    for build in builds:
        path = pick_path(build)
        if path is None:
            continue
        out.append(
            _Build(name=build.name, timestamp=build.timestamp, asmap=loaded[path].asmap)
        )
    out.sort(key=lambda b: b.timestamp)
    return out


def _diffable_builds(builds: list, loaded: dict) -> list[_Build]:
    """The builds the Diff Explorer can pair: those with an unfilled
    variant. Matching the diff pipeline's unfilled-vs-unfilled set keeps
    the ``"<from>|<to>"`` keys in lockstep with the frontend's diff keys."""
    return _lift_builds(builds, loaded, lambda build: build.unfilled_path)


def _decay_window(
    anchor: Snapshot,
    prepared_builds: list[_Build],
    reference: _Build,
    target: TargetFn,
) -> dict | None:
    """Drift curve for ``anchor`` over the builds at or older than it (same
    one-day tolerance as ``_select_in_effect_build``), so a frozen crawl
    stops at its last observation and its freshest point lands on its own
    same-day build."""
    window = [
        b
        for b in prepared_builds
        if b.timestamp <= anchor.timestamp + IN_EFFECT_TOLERANCE_SECONDS
    ]
    if not window:
        return None
    return _drift_curve(anchor, window, window[-1], reference, target)


def _build_source_entry(
    usable: list[Snapshot],
    prepared_builds: list[_Build],
    reference: _Build,
    diffable: list[_Build],
) -> dict:
    """One source's payload: per-snapshot series, up to two decay curves,
    and the latest-update card.

    ``decay`` (vs the snapshot's own freshest map) exists for every crawler;
    ``decay_truth`` (vs crawler whois) needs a whois-bearing anchor, so
    whois-less crawlers (BitMEX CSVs) omit it and are greyed out of that view.
    """
    series = [
        _snapshot_metrics(s, _select_in_effect_build(prepared_builds, s.timestamp))
        for s in usable
    ]
    entry: dict = {"snapshots": series}

    map_curve = _decay_window(usable[-1], prepared_builds, reference, _map_target)
    if map_curve is not None:
        entry["decay"] = map_curve

    truth_anchor = next(
        (s for s in reversed(usable) if any(n.asn is not None for n in s.nodes)),
        None,
    )
    if truth_anchor is not None:
        truth_curve = _decay_window(
            truth_anchor, prepared_builds, reference, _truth_target
        )
        if truth_curve is not None:
            entry["decay_truth"] = truth_curve

    latest_update = _latest_update_impact(usable[-1], diffable)
    if latest_update is not None:
        entry["latest_update"] = latest_update
    return entry


def _build_diff_banner(
    latest_snapshot_by_source: dict[str, Snapshot],
    sources_out: dict[str, dict],
    diffable: list[_Build],
) -> dict:
    """Diff-banner keys: score the primary source's newest node set against
    every diffable pair. The keys are optional in the payload, so an older
    network.json without them still renders.
    """
    primary = next(
        (s for s in PRIMARY_SOURCE_ORDER if s in latest_snapshot_by_source),
        next(iter(latest_snapshot_by_source)),
    )
    node_set = latest_snapshot_by_source[primary]
    meta = {
        "node_set_source": primary,
        "node_set_label": node_set.label,
        "node_set_timestamp": node_set.timestamp,
    }
    banner: dict = {}
    # Reuse the primary's own per-source latest_update rather than recompute.
    primary_latest = sources_out[primary].get("latest_update")
    if primary_latest is not None:
        banner["latest_update"] = {**meta, **primary_latest}
    banner["pair_impact"] = {**meta, **_build_node_impact(node_set, diffable)}
    return banner


def build_network_section(
    builds: list,
    loaded: dict,
    snapshots_by_source: dict[str, list[Snapshot]],
) -> dict:
    """Assemble the ``network`` payload from snapshots and loaded builds.

    ``builds`` is the ``DiscoveredBuild`` list from ``metrics.discover_maps``
    and ``loaded`` the path -> ``LoadedMap`` cache, so this reuses the maps
    the Maps/Diff pipeline already parsed instead of re-reading any .dat
    file. Each source contributes a per-snapshot series plus its decay
    curves; the primary source also feeds the diff banner.

    Returns ``{}`` when there are no builds or no usable snapshots, keeping
    the caller's "omit the key entirely" contract simple.
    """
    prepared_builds = _prepare_builds(builds, loaded)
    if not prepared_builds:
        return {}
    reference = prepared_builds[-1]
    diffable = _diffable_builds(builds, loaded)

    sources_out: dict[str, dict] = {}
    latest_snapshot_by_source: dict[str, Snapshot] = {}
    for source, snapshots in snapshots_by_source.items():
        usable = [s for s in snapshots if s.nodes]
        if not usable:
            continue
        sources_out[source] = _build_source_entry(
            usable, prepared_builds, reference, diffable
        )
        latest_snapshot_by_source[source] = usable[-1]

    if not sources_out:
        return {}

    out: dict = {
        "reference_timestamp": reference.timestamp,
        "sources": sources_out,
    }
    if len(diffable) >= 2:
        out.update(_build_diff_banner(latest_snapshot_by_source, sources_out, diffable))
    return out


def _prepare_builds(builds: list, loaded: dict) -> list[_Build]:
    """Lift DiscoveredBuilds into _Build, preferring unfilled.

    Filled and unfilled resolve every lookup identically (filling only
    merges adjacent same-AS prefixes), so a filled-only build is still a
    valid lookup source; unfilled is preferred only to match the diff
    pipeline's choice.
    """
    return _lift_builds(
        builds, loaded, lambda build: build.unfilled_path or build.filled_path
    )


def _age_days(build_ts: int, reference_ts: int) -> int:
    """Whole days ``build_ts`` predates ``reference_ts`` (never negative)."""
    return max(0, (reference_ts - build_ts) // SECONDS_PER_DAY)


def _ratio(numerator: int, denominator: int) -> float:
    return round(numerator / denominator, 4) if denominator else 0.0
