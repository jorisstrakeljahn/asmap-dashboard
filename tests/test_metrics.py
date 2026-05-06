"""Tests for asmap_dashboard.metrics."""

from __future__ import annotations

import ipaddress

from asmap_dashboard.metrics import discover_maps, generate_dashboard_data

from .conftest import write_asmap


def _layout_three_builds(tmp_path):
    """Create a tiny year-folder layout with three filled builds and one
    unfilled file that should be ignored by the discovery rule."""
    (tmp_path / "2024").mkdir()
    (tmp_path / "2025").mkdir()
    write_asmap(
        tmp_path / "2024" / "1700000000_asmap.dat",
        [(ipaddress.IPv4Network("1.0.0.0/8"), 100)],
    )
    write_asmap(
        tmp_path / "2024" / "1710000000_asmap.dat",
        [(ipaddress.IPv4Network("1.0.0.0/8"), 200)],
    )
    write_asmap(
        tmp_path / "2025" / "1750000000_asmap.dat",
        [(ipaddress.IPv4Network("1.0.0.0/8"), 300)],
    )
    write_asmap(
        tmp_path / "2024" / "1700000000_asmap_unfilled.dat",
        [(ipaddress.IPv4Network("99.0.0.0/8"), 999)],
    )


def test_discover_maps_skips_unfilled_and_sorts_by_timestamp(tmp_path):
    """Discovery only matches *_asmap.dat (skipping unfilled) and sorts by released timestamp."""
    _layout_three_builds(tmp_path)

    found = discover_maps(tmp_path)

    assert [ts for ts, _ in found] == [1700000000, 1710000000, 1750000000]
    assert all("unfilled" not in str(p) for _, p in found)


def test_generate_dashboard_data_shape(tmp_path):
    """Generated payload contains every map and every unordered pair diff."""
    _layout_three_builds(tmp_path)

    payload = generate_dashboard_data(tmp_path)

    assert "generated_at" in payload
    assert payload["source"]["data_dir"] == str(tmp_path)

    assert [m["name"] for m in payload["maps"]] == [
        "2024/1700000000_asmap.dat",
        "2024/1710000000_asmap.dat",
        "2025/1750000000_asmap.dat",
    ]
    assert payload["maps"][0]["released_at"] == "2023-11-14"

    assert [(d["from"], d["to"]) for d in payload["diffs"]] == [
        ("2024/1700000000_asmap.dat", "2024/1710000000_asmap.dat"),
        ("2024/1700000000_asmap.dat", "2025/1750000000_asmap.dat"),
        ("2024/1710000000_asmap.dat", "2025/1750000000_asmap.dat"),
    ]
    assert all(d["total_changes"] == 1 for d in payload["diffs"])


def test_generate_dashboard_data_with_empty_dir(tmp_path):
    """An empty data directory produces an empty maps and diffs payload."""
    payload = generate_dashboard_data(tmp_path)

    assert payload["maps"] == []
    assert payload["diffs"] == []


def test_generate_dashboard_data_emits_combinations_for_four_builds(tmp_path):
    """Four maps produce C(4, 2) = 6 diffs covering every unordered pair."""
    (tmp_path / "2024").mkdir()
    for i, ts in enumerate([1700000000, 1710000000, 1720000000, 1730000000]):
        write_asmap(
            tmp_path / "2024" / f"{ts}_asmap.dat",
            [(ipaddress.IPv4Network(f"{i + 1}.0.0.0/8"), 100 + i)],
        )

    payload = generate_dashboard_data(tmp_path)

    assert len(payload["maps"]) == 4
    assert len(payload["diffs"]) == 6
    assert all(d["from"] < d["to"] for d in payload["diffs"])
    pairs = {(d["from"], d["to"]) for d in payload["diffs"]}
    assert len(pairs) == 6

