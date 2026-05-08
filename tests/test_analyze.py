"""Tests for asmap_dashboard.analyze."""

from __future__ import annotations

import ipaddress

import pytest

from asmap_dashboard.analyze import analyze_loaded_map, analyze_map
from asmap_dashboard.loader import load_map

from .conftest import write_asmap


def test_analyze_counts_ipv4_and_ipv6_entries(tmp_path):
    path = write_asmap(
        tmp_path / "mixed.dat",
        [
            (ipaddress.IPv4Network("1.0.0.0/8"), 100),
            (ipaddress.IPv4Network("2.0.0.0/8"), 200),
            (ipaddress.IPv6Network("2001::/16"), 300),
        ],
    )

    profile = analyze_map(path)

    assert profile["entries_count"] == 3
    assert profile["unique_asns"] == 3
    assert profile["ipv4_count"] == 2
    assert profile["ipv6_count"] == 1
    assert profile["file_size_bytes"] == path.stat().st_size


def test_top_ases_are_ranked_by_prefix_count(tmp_path):
    path = write_asmap(
        tmp_path / "ranked.dat",
        [
            (ipaddress.IPv4Network("10.0.0.0/8"), 100),
            (ipaddress.IPv4Network("20.0.0.0/8"), 200),
            (ipaddress.IPv4Network("30.0.0.0/8"), 200),
            (ipaddress.IPv4Network("40.0.0.0/8"), 300),
            (ipaddress.IPv4Network("50.0.0.0/8"), 300),
            (ipaddress.IPv4Network("60.0.0.0/8"), 300),
        ],
    )

    profile = analyze_map(path)

    assert [entry["asn"] for entry in profile["top_ases"]] == [300, 200, 100]
    assert [entry["prefix_count"] for entry in profile["top_ases"]] == [3, 2, 1]


def test_unmapped_entries_are_excluded_from_unique_asns(tmp_path):
    path = write_asmap(
        tmp_path / "with-zero.dat",
        [
            (ipaddress.IPv4Network("1.0.0.0/8"), 100),
            (ipaddress.IPv4Network("2.0.0.0/8"), 0),
        ],
    )

    profile = analyze_map(path)

    assert profile["unique_asns"] == 1
    assert all(entry["asn"] != 0 for entry in profile["top_ases"])


def test_top_ases_capped_at_twenty(tmp_path):
    entries = [
        (ipaddress.IPv4Network(f"{octet}.0.0.0/8"), 1000 + octet)
        for octet in range(1, 26)
    ]
    path = write_asmap(tmp_path / "many.dat", entries)

    profile = analyze_map(path)

    assert len(profile["top_ases"]) == 20


def test_invalid_file_raises_value_error(tmp_path):
    path = tmp_path / "garbage.dat"
    path.write_bytes(b"\xff" * 32)

    with pytest.raises(ValueError):
        analyze_map(path)


def test_realistic_mixed_map(tmp_path):
    """An IPv4+IPv6 map with one AS owning multiple prefixes ranks it on top."""
    path = write_asmap(
        tmp_path / "mixed.dat",
        [
            (ipaddress.IPv4Network("1.0.0.0/8"), 100),
            (ipaddress.IPv4Network("16.0.0.0/8"), 100),
            (ipaddress.IPv4Network("32.0.0.0/8"), 200),
            (ipaddress.IPv6Network("2001::/16"), 300),
            (ipaddress.IPv6Network("2a00::/16"), 400),
        ],
    )

    profile = analyze_map(path)

    assert profile["entries_count"] == 5
    assert profile["ipv4_count"] == 3
    assert profile["ipv6_count"] == 2
    assert profile["unique_asns"] == 4
    assert profile["top_ases"][0] == {"asn": 100, "prefix_count": 2}


def test_analyze_loaded_map_matches_analyze_map(tmp_path):
    """The pipeline entry point must produce the same profile as the CLI one."""
    path = write_asmap(
        tmp_path / "shared.dat",
        [
            (ipaddress.IPv4Network("1.0.0.0/8"), 100),
            (ipaddress.IPv4Network("2.0.0.0/8"), 200),
            (ipaddress.IPv6Network("2001::/16"), 300),
        ],
    )

    assert analyze_loaded_map(load_map(path)) == analyze_map(path)
