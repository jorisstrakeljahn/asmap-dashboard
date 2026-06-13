"""Tests for asmap_dashboard.network.metrics."""

from __future__ import annotations

import ipaddress
import json

from asmap_dashboard._vendor.asmap import ASMap, net_to_prefix
from asmap_dashboard.metrics import generate_dashboard_data
from asmap_dashboard.network.metrics import (
    _Build,
    _build_node_impact,
    _classify_change,
    _decay_curve,
    _impact_dict,
    _select_in_effect_build,
    _snapshot_metrics,
)
from asmap_dashboard.network.snapshots import Node, Snapshot

from .conftest import write_asmap


def _asmap(entries):
    return ASMap(
        [(net_to_prefix(ipaddress.ip_network(net)), asn) for net, asn in entries]
    )


def _build(name, ts, entries):
    return _Build(name=name, timestamp=ts, asmap=_asmap(entries))


def _snapshot(ts, nodes):
    return Snapshot(
        source="test",
        timestamp=ts,
        label="2026-01-01",
        nodes=tuple(nodes),
        observed_total=len(nodes),
        onion_skipped=0,
        unresolved_skipped=0,
    )


# build1: 1.0.0.0/8 and 2.0.0.0/8 both AS100.
# build2: 1.0.0.0/8 moved to AS200, 2.0.0.0/8 still AS100.
BUILD1 = _build("2023/1700000000", 1700000000, [("1.0.0.0/8", 100), ("2.0.0.0/8", 100)])
BUILD2 = _build("2024/1710000000", 1710000000, [("1.0.0.0/8", 200), ("2.0.0.0/8", 100)])

NODES = [
    Node(ip="1.1.1.1", version=4, asn=200, country="DE"),
    Node(ip="2.2.2.2", version=4, asn=100, country="DE"),
    Node(ip="3.3.3.3", version=4, asn=None, country=None),  # unmapped in both
]


def test_select_in_effect_build_picks_latest_at_or_before():
    builds = [BUILD1, BUILD2]
    assert _select_in_effect_build(builds, 1705000000).name == BUILD1.name
    assert _select_in_effect_build(builds, 1710000001).name == BUILD2.name
    # Older than every build falls back to the earliest.
    assert _select_in_effect_build(builds, 1600000000).name == BUILD1.name


def test_snapshot_metrics_counts_mapping_hhi_and_bucketing():
    snap = _snapshot(1710000001, NODES)

    result = _snapshot_metrics(snap, BUILD2)

    assert result["nodes_clearnet"] == 3
    # Coverage: 1.1.1.1 and 2.2.2.2 resolve, 3.3.3.3 does not.
    assert result["mapped"] == 2
    assert result["unique_asns"] == 2
    # Two ASes with one node each -> HHI = 0.5^2 + 0.5^2 = 0.5.
    assert result["hhi"] == 0.5
    # Two equal ASes: one AS alone holds exactly half the mapped
    # nodes, so the 50 % threshold is met at rank 1.
    assert result["nakamoto_50"] == 1
    # Three distinct /16 default groups; ASmap keeps two AS buckets plus
    # the default-group fallback for the unmapped node = three buckets.
    assert result["bucketing"]["default_groups"] == 3
    assert result["bucketing"]["asmap_groups"] == 3


def test_snapshot_metrics_splits_families_by_effective_family():
    """IPv4 and IPv6 nodes land in their own family slices.

    The 6to4 node (2002::/16 wrapping 1.1.9.9) counts as IPv4 — the
    effective family after the linked-IPv4 unwrap — exactly like
    Core's GetGroup() buckets it.
    """
    nodes = [
        Node(ip="1.1.1.1", version=4, asn=None, country=None),
        Node(ip="2002:101:909::1", version=6, asn=None, country=None),
        Node(ip="2a01::1", version=6, asn=None, country=None),
    ]
    snap = _snapshot(1710000001, nodes)

    result = _snapshot_metrics(snap, BUILD2)

    families = result["families"]
    assert families["ipv4"]["nodes"] == 2
    assert families["ipv4"]["mapped"] == 2  # both fall in 1.0.0.0/8 -> AS200
    assert families["ipv4"]["hhi"] == 1.0
    assert families["ipv6"]["nodes"] == 1
    assert families["ipv6"]["mapped"] == 0
    # An empty mapped set yields the explicit zero state, not a crash.
    assert families["ipv6"]["hhi"] == 0.0
    # Family slices partition the snapshot exactly.
    assert (
        families["ipv4"]["nodes"] + families["ipv6"]["nodes"]
        == result["nodes_clearnet"]
    )


def test_nakamoto_coefficient_counts_ases_to_half():
    # 6 mapped nodes: AS1 holds 2, AS2 holds 2, AS3/AS4 hold 1 each.
    # Half is 3 nodes -> AS1 alone (2) is short, AS1+AS2 (4) reaches it.
    nodes = [
        Node(ip="1.0.0.1", version=4, asn=None, country=None),
        Node(ip="1.0.0.2", version=4, asn=None, country=None),
        Node(ip="2.0.0.1", version=4, asn=None, country=None),
        Node(ip="2.0.0.2", version=4, asn=None, country=None),
        Node(ip="3.0.0.1", version=4, asn=None, country=None),
        Node(ip="4.0.0.1", version=4, asn=None, country=None),
    ]
    build = _build(
        "2024/1710000000",
        1710000000,
        [
            ("1.0.0.0/8", 1),
            ("2.0.0.0/8", 2),
            ("3.0.0.0/8", 3),
            ("4.0.0.0/8", 4),
        ],
    )
    snap = _snapshot(1710000001, nodes)

    result = _snapshot_metrics(snap, build)

    assert result["mapped"] == 6
    assert result["nakamoto_50"] == 2


def test_nakamoto_coefficient_is_none_when_nothing_is_mapped():
    nodes = [Node(ip="9.9.9.9", version=4, asn=None, country=None)]
    snap = _snapshot(1710000001, nodes)

    result = _snapshot_metrics(snap, BUILD2)

    assert result["mapped"] == 0
    assert result["nakamoto_50"] is None


def test_snapshot_metrics_unwraps_tunneled_ipv4_like_core():
    """A 6to4 peer scores as its embedded IPv4 on both bucket scales.

    The 6to4 address embeds 1.1.9.9 (2002:0101:0909::), which BUILD2
    maps to AS200 — exactly what Core's GetMappedAS() would resolve.
    Its default bucket is the embedded IPv4's /16, shared with the
    native 1.1.1.1 node, so neither vocabulary treats the tunnel
    wrapper as a separate location.
    """
    nodes = [
        Node(ip="1.1.1.1", version=4, asn=200, country="DE"),
        Node(ip="2002:101:909::1", version=6, asn=None, country=None),
    ]
    snap = _snapshot(1710000001, nodes)

    result = _snapshot_metrics(snap, BUILD2)

    # Both nodes resolve to AS200 -> one AS, HHI 1.0, one AS bucket.
    assert result["unique_asns"] == 1
    assert result["hhi"] == 1.0
    assert result["bucketing"]["asmap_groups"] == 1
    # And one shared default /16 bucket (1.1.0.0/16).
    assert result["bucketing"]["default_groups"] == 1


def test_snapshot_metrics_cross_check_when_annotated():
    snap = _snapshot(1710000001, NODES)

    result = _snapshot_metrics(snap, BUILD2)

    # Both annotated nodes agree with the ASmap lookup under build2.
    assert result["cross_check"] == {
        "compared": 2,
        "agree": 2,
        "agreement_pct": 100.0,
    }


def test_snapshot_metrics_hides_cross_check_when_coverage_thin():
    # No node carries crawler whois (Bitnodes' compact form).
    bare = [Node(ip="1.1.1.1", version=4, asn=None, country=None)]
    snap = _snapshot(1710000001, bare)

    result = _snapshot_metrics(snap, BUILD2)

    assert result["cross_check"] is None


def test_decay_curve_is_anchored_on_reference_and_fixed_node_set():
    snap = _snapshot(1710000001, NODES)

    decay = _decay_curve(snap, [BUILD1, BUILD2], reference=BUILD2)

    assert decay["reference_build"] == BUILD2.name
    # Only the two nodes the reference maps to a real AS are scored.
    assert decay["node_set_size"] == 2
    points = {p["build"]: p for p in decay["points"]}
    # Against build1, 1.1.1.1 resolved to AS100 instead of AS200 -> 1/2.
    assert points[BUILD1.name]["drift_pct"] == 50.0
    # The reference vs itself never drifts.
    assert points[BUILD2.name]["drift_pct"] == 0.0
    # Age is measured from the reference release backwards, never negative.
    assert points[BUILD1.name]["age_days"] == 115
    assert points[BUILD2.name]["age_days"] == 0


def test_classify_change_buckets_like_node_impact():
    assert _classify_change(100, 100) is None  # unchanged
    assert _classify_change(0, 200) == "newly_mapped"  # unmapped -> mapped
    assert _classify_change(100, 0) == "unmapped"  # mapped -> unmapped
    assert _classify_change(100, 200) == "reassigned"  # mapped -> different AS


def test_impact_dict_counts_overall_and_per_family():
    # Two IPv4 nodes and one IPv6 node. From map A to map B:
    #   node 0 (v4): AS100 -> AS200  = reassigned
    #   node 1 (v4): AS100 -> AS100  = unchanged
    #   node 2 (v6): 0     -> AS300  = newly_mapped
    families = ["ipv4", "ipv4", "ipv6"]
    asns_a = [100, 100, 0]
    asns_b = [200, 100, 300]

    result = _impact_dict(families, asns_a, asns_b)

    assert result["total_nodes"] == 3
    assert result["reassigned"] == 1
    assert result["newly_mapped"] == 1
    assert result["unmapped"] == 0
    assert result["total_affected"] == 2
    # Family slices partition the node set and the changes.
    assert result["families"]["ipv4"]["total_nodes"] == 2
    assert result["families"]["ipv4"]["reassigned"] == 1
    assert result["families"]["ipv4"]["total_affected"] == 1
    assert result["families"]["ipv6"]["total_nodes"] == 1
    assert result["families"]["ipv6"]["newly_mapped"] == 1


def test_build_node_impact_emits_pairs_and_latest_update():
    # Three diffable builds: 1.0.0.0/8 walks AS100 -> AS200 -> AS300.
    build1 = _build("2023/1700000000", 1700000000, [("1.0.0.0/8", 100)])
    build2 = _build("2024/1710000000", 1710000000, [("1.0.0.0/8", 200)])
    build3 = _build("2025/1720000000", 1720000000, [("1.0.0.0/8", 300)])
    snap = _snapshot(
        1720000001, [Node(ip="1.1.1.1", version=4, asn=None, country=None)]
    )

    latest_update, pair_impact = _build_node_impact(snap, [build1, build2, build3])

    # One entry per (from, to) pair, keyed to match the diff keys.
    assert set(pair_impact["pairs"]) == {
        "2023/1700000000|2024/1710000000",
        "2023/1700000000|2025/1720000000",
        "2024/1710000000|2025/1720000000",
    }
    # The node sits in 1.0.0.0/8, which is reassigned across every pair.
    one_pair = pair_impact["pairs"]["2023/1700000000|2024/1710000000"]
    assert one_pair["total_nodes"] == 1
    assert one_pair["reassigned"] == 1
    # latest_update is the two most recent builds.
    assert latest_update["from_build"] == build2.name
    assert latest_update["to_build"] == build3.name
    assert latest_update["reassigned"] == 1


def test_build_node_impact_latest_update_none_with_single_build():
    build = _build("2024/1710000000", 1710000000, [("1.0.0.0/8", 100)])
    snap = _snapshot(
        1710000001, [Node(ip="1.1.1.1", version=4, asn=None, country=None)]
    )

    latest_update, pair_impact = _build_node_impact(snap, [build])

    assert latest_update is None
    assert pair_impact["pairs"] == {}


def _write_kit_dossier(path, ip_to_asn):
    doc = {
        f"(IPv4Address('{ip}'), 8333)": {
            "whois": {"asn": str(asn), "asn_country_code": "DE"}
        }
        for ip, asn in ip_to_asn.items()
    }
    path.write_text(json.dumps(doc))


def test_generate_dashboard_data_attaches_network_when_sources_given(tmp_path):
    data_dir = tmp_path / "asmap-data"
    (data_dir / "2024").mkdir(parents=True)
    for ts, asn in [(1700000000, 100), (1710000000, 200)]:
        write_asmap(
            data_dir / "2024" / f"{ts}_asmap_unfilled.dat",
            [(ipaddress.IPv4Network("1.0.0.0/8"), asn)],
        )

    kit_dir = tmp_path / "kit"
    kit_dir.mkdir()
    _write_kit_dossier(kit_dir / "20240315_120000_dossier.json", {"1.1.1.1": 200})

    payload = generate_dashboard_data(data_dir, snapshot_sources={"kit": kit_dir})

    assert "network" in payload
    assert "kit" in payload["network"]["sources"]
    kit = payload["network"]["sources"]["kit"]
    assert len(kit["snapshots"]) == 1
    assert kit["decay"]["reference_build"] == "2024/1710000000"
    # Node impact rides along: the node 1.1.1.1 (in 1.0.0.0/8) is
    # reassigned AS100 -> AS200 between the two diffable builds.
    network = payload["network"]
    assert network["latest_update"]["node_set_source"] == "kit"
    assert network["latest_update"]["reassigned"] == 1
    pair_key = "2024/1700000000|2024/1710000000"
    assert network["pair_impact"]["pairs"][pair_key]["reassigned"] == 1


def test_generate_dashboard_data_omits_network_without_sources(tmp_path):
    data_dir = tmp_path / "asmap-data"
    (data_dir / "2024").mkdir(parents=True)
    write_asmap(
        data_dir / "2024" / "1700000000_asmap_unfilled.dat",
        [(ipaddress.IPv4Network("1.0.0.0/8"), 100)],
    )

    payload = generate_dashboard_data(data_dir)

    assert set(payload.keys()) == {"maps", "diffs"}
