"""Tests for asmap_dashboard.metrics."""

from __future__ import annotations

import ipaddress
import json

from asmap_dashboard.metrics import discover_maps, generate_dashboard_data

from .conftest import write_asmap


def _layout_three_builds(tmp_path):
    """Create a tiny year-folder layout with three builds.

    Each timestamp publishes both variants - filled (``*_asmap.dat``)
    and unfilled (``*_asmap_unfilled.dat``) - so legacy callers that
    only look at the filled side keep seeing three builds. The newer
    variant-aware tests use this same layout to assert that discovery
    pairs both files into one ``DiscoveredBuild`` entry.
    """
    (tmp_path / "2024").mkdir()
    (tmp_path / "2025").mkdir()
    for year, ts, asn in [
        ("2024", 1700000000, 100),
        ("2024", 1710000000, 200),
        ("2025", 1750000000, 300),
    ]:
        write_asmap(
            tmp_path / year / f"{ts}_asmap.dat",
            [(ipaddress.IPv4Network("1.0.0.0/8"), asn)],
        )
        write_asmap(
            tmp_path / year / f"{ts}_asmap_unfilled.dat",
            [(ipaddress.IPv4Network("1.0.0.0/8"), asn)],
        )


def test_discover_maps_pairs_both_variants_per_build(tmp_path):
    """A build with both files surfaces as one entry holding both paths."""
    _layout_three_builds(tmp_path)

    found = discover_maps(tmp_path)

    assert [b.timestamp for b in found] == [1700000000, 1710000000, 1750000000]
    assert [b.name for b in found] == [
        "2024/1700000000",
        "2024/1710000000",
        "2025/1750000000",
    ]
    assert all(b.unfilled_path is not None for b in found)
    assert all(b.filled_path is not None for b in found)
    # Variant identification is filename-driven: filled never carries
    # the ``_unfilled`` suffix, unfilled always does.
    assert all("_unfilled" not in b.filled_path.name for b in found)
    assert all(b.unfilled_path.name.endswith("_unfilled.dat") for b in found)


def test_discover_maps_handles_unfilled_only_build(tmp_path):
    """A build that only ships unfilled (e.g. all 2024 builds) still appears."""
    (tmp_path / "2024").mkdir()
    write_asmap(
        tmp_path / "2024" / "1704463200_asmap_unfilled.dat",
        [(ipaddress.IPv4Network("1.0.0.0/8"), 100)],
    )

    [build] = discover_maps(tmp_path)

    assert build.timestamp == 1704463200
    assert build.name == "2024/1704463200"
    assert build.unfilled_path is not None
    assert build.filled_path is None


def test_discover_maps_handles_filled_only_build(tmp_path):
    """A build that only ships filled (e.g. 2025-03-21) still appears."""
    (tmp_path / "2025").mkdir()
    write_asmap(
        tmp_path / "2025" / "1742572800_asmap.dat",
        [(ipaddress.IPv4Network("1.0.0.0/8"), 100)],
    )

    [build] = discover_maps(tmp_path)

    assert build.timestamp == 1742572800
    assert build.name == "2025/1742572800"
    assert build.unfilled_path is None
    assert build.filled_path is not None


def test_discover_maps_mixes_filled_only_and_both_variants(tmp_path):
    """Mixed inventory: one filled-only, one unfilled-only, one with both."""
    (tmp_path / "2024").mkdir()
    (tmp_path / "2025").mkdir()
    write_asmap(
        tmp_path / "2024" / "1704463200_asmap_unfilled.dat",
        [(ipaddress.IPv4Network("1.0.0.0/8"), 100)],
    )
    write_asmap(
        tmp_path / "2025" / "1742572800_asmap.dat",
        [(ipaddress.IPv4Network("1.0.0.0/8"), 200)],
    )
    write_asmap(
        tmp_path / "2025" / "1755187200_asmap.dat",
        [(ipaddress.IPv4Network("1.0.0.0/8"), 300)],
    )
    write_asmap(
        tmp_path / "2025" / "1755187200_asmap_unfilled.dat",
        [(ipaddress.IPv4Network("1.0.0.0/8"), 300)],
    )

    found = discover_maps(tmp_path)

    assert [b.timestamp for b in found] == [
        1704463200,
        1742572800,
        1755187200,
    ]
    assert [(bool(b.unfilled_path), bool(b.filled_path)) for b in found] == [
        (True, False),
        (False, True),
        (True, True),
    ]


def test_discover_maps_ignores_non_year_directories(tmp_path):
    """Discovery walks only four-digit year folders, so docs/ or .git/ are skipped."""
    _layout_three_builds(tmp_path)
    (tmp_path / "docs").mkdir()
    write_asmap(
        tmp_path / "docs" / "1799999999_asmap.dat",
        [(ipaddress.IPv4Network("9.0.0.0/8"), 999)],
    )
    (tmp_path / ".git").mkdir()
    write_asmap(
        tmp_path / ".git" / "1799999999_asmap.dat",
        [(ipaddress.IPv4Network("9.0.0.0/8"), 999)],
    )

    found = discover_maps(tmp_path)

    assert [b.timestamp for b in found] == [1700000000, 1710000000, 1750000000]


def test_discover_maps_ignores_root_latest_convenience_copy(tmp_path):
    """``latest_asmap.dat`` at the data-dir root is not in any year folder."""
    _layout_three_builds(tmp_path)
    write_asmap(
        tmp_path / "latest_asmap.dat",
        [(ipaddress.IPv4Network("9.0.0.0/8"), 999)],
    )

    found = discover_maps(tmp_path)

    assert [b.timestamp for b in found] == [1700000000, 1710000000, 1750000000]


def test_generate_dashboard_data_uses_variant_agnostic_build_names(tmp_path):
    """Each build appears once under <year>/<timestamp>, not per file."""
    _layout_three_builds(tmp_path)

    payload = generate_dashboard_data(tmp_path)

    assert set(payload.keys()) == {"maps", "diffs"}

    assert [m["name"] for m in payload["maps"]] == [
        "2024/1700000000",
        "2024/1710000000",
        "2025/1750000000",
    ]
    assert payload["maps"][0]["released_at"] == "2023-11-14"

    # Diffs use the same variant-agnostic build names, not file paths.
    assert [(d["from"], d["to"]) for d in payload["diffs"]] == [
        ("2024/1700000000", "2024/1710000000"),
        ("2024/1700000000", "2025/1750000000"),
        ("2024/1710000000", "2025/1750000000"),
    ]
    assert all(d["variant"] == "unfilled" for d in payload["diffs"])
    assert all(d["total_changes"] == 1 for d in payload["diffs"])


def test_generate_dashboard_data_attaches_both_variants_when_published(tmp_path):
    """Each map carries unfilled and filled sub-objects with their profiles."""
    _layout_three_builds(tmp_path)

    payload = generate_dashboard_data(tmp_path)

    first = payload["maps"][0]
    assert first["unfilled"]["present"] is True
    assert first["filled"]["present"] is True
    assert first["unfilled"]["path"] == "2024/1700000000_asmap_unfilled.dat"
    assert first["filled"]["path"] == "2024/1700000000_asmap.dat"
    # Profile fields ride alongside `present` and `path` so the
    # frontend can read map.unfilled.entries_count without a wrapper.
    assert first["unfilled"]["entries_count"] == 1
    assert first["filled"]["entries_count"] == 1


def test_generate_dashboard_data_marks_missing_variant_present_false(tmp_path):
    """An unfilled-only build emits filled.present == false (and vice versa)."""
    (tmp_path / "2024").mkdir()
    (tmp_path / "2025").mkdir()
    write_asmap(
        tmp_path / "2024" / "1704463200_asmap_unfilled.dat",
        [(ipaddress.IPv4Network("1.0.0.0/8"), 100)],
    )
    write_asmap(
        tmp_path / "2025" / "1742572800_asmap.dat",
        [(ipaddress.IPv4Network("1.0.0.0/8"), 200)],
    )

    payload = generate_dashboard_data(tmp_path)

    [unfilled_only, filled_only] = payload["maps"]
    assert unfilled_only["unfilled"]["present"] is True
    assert unfilled_only["filled"] == {"present": False}
    assert filled_only["filled"]["present"] is True
    assert filled_only["unfilled"] == {"present": False}


def test_generate_dashboard_data_with_empty_dir(tmp_path):
    """An empty data directory produces an empty maps and diffs payload."""
    payload = generate_dashboard_data(tmp_path)

    assert payload["maps"] == []
    assert payload["diffs"] == []


def test_generate_dashboard_data_emits_combinations_for_four_builds(tmp_path):
    """Four builds with both variants produce C(4, 2) = 6 unfilled diffs."""
    (tmp_path / "2024").mkdir()
    for i, ts in enumerate([1700000000, 1710000000, 1720000000, 1730000000]):
        for suffix in ("_asmap.dat", "_asmap_unfilled.dat"):
            write_asmap(
                tmp_path / "2024" / f"{ts}{suffix}",
                [(ipaddress.IPv4Network(f"{i + 1}.0.0.0/8"), 100 + i)],
            )

    payload = generate_dashboard_data(tmp_path)

    assert len(payload["maps"]) == 4
    assert len(payload["diffs"]) == 6
    assert all(d["from"] < d["to"] for d in payload["diffs"])
    pairs = {(d["from"], d["to"]) for d in payload["diffs"]}
    assert len(pairs) == 6


def test_generate_dashboard_data_skips_pairs_without_unfilled(tmp_path):
    """Filled-only builds are absent from the unfilled-vs-unfilled diff timeline."""
    (tmp_path / "2024").mkdir()
    (tmp_path / "2025").mkdir()
    # Two builds that ship both variants and one filled-only build
    # in between. The diff timeline should connect the two variant-
    # complete builds and leave the filled-only one out.
    for ts, asn in [(1700000000, 100), (1750000000, 200)]:
        for suffix in ("_asmap.dat", "_asmap_unfilled.dat"):
            year = "2024" if ts < 1735689600 else "2025"
            write_asmap(
                tmp_path / year / f"{ts}{suffix}",
                [(ipaddress.IPv4Network("1.0.0.0/8"), asn)],
            )
    write_asmap(
        tmp_path / "2025" / "1742572800_asmap.dat",
        [(ipaddress.IPv4Network("1.0.0.0/8"), 999)],
    )

    payload = generate_dashboard_data(tmp_path)

    assert [m["name"] for m in payload["maps"]] == [
        "2024/1700000000",
        "2025/1742572800",
        "2025/1750000000",
    ]
    # Only one diff: unfilled-vs-unfilled across the gap.
    assert [(d["from"], d["to"]) for d in payload["diffs"]] == [
        ("2024/1700000000", "2025/1750000000"),
    ]
    assert payload["diffs"][0]["variant"] == "unfilled"


def test_generate_dashboard_data_is_deterministic(tmp_path):
    """Two runs against the same data directory produce byte-equal payloads."""
    _layout_three_builds(tmp_path)

    a = json.dumps(generate_dashboard_data(tmp_path), sort_keys=True)
    b = json.dumps(generate_dashboard_data(tmp_path), sort_keys=True)

    assert a == b
