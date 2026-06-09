"""Tests for asmap_dashboard.network.metrics."""

from __future__ import annotations

import ipaddress
import json

from asmap_dashboard._vendor.asmap import ASMap, net_to_prefix
from asmap_dashboard.metrics import generate_dashboard_data
from asmap_dashboard.network.metrics import (
    _Build,
    _decay_curve,
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
    assert result["unique_asns"] == 2
    # Two ASes with one node each -> HHI = 0.5^2 + 0.5^2 = 0.5.
    assert result["hhi"] == 0.5
    # Three distinct /16 default groups; ASmap keeps two AS buckets plus
    # the default-group fallback for the unmapped node = three buckets.
    assert result["bucketing"]["default_groups"] == 3
    assert result["bucketing"]["asmap_groups"] == 3


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


def test_generate_dashboard_data_omits_network_without_sources(tmp_path):
    data_dir = tmp_path / "asmap-data"
    (data_dir / "2024").mkdir(parents=True)
    write_asmap(
        data_dir / "2024" / "1700000000_asmap_unfilled.dat",
        [(ipaddress.IPv4Network("1.0.0.0/8"), 100)],
    )

    payload = generate_dashboard_data(data_dir)

    assert set(payload.keys()) == {"maps", "diffs"}
