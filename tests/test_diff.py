"""Tests for asmap_dashboard.diff."""

from __future__ import annotations

import ipaddress

from asmap_dashboard.diff import diff_maps

from .conftest import write_asmap


def test_identical_maps_produce_no_changes(tmp_path):
    entries = [
        (ipaddress.IPv4Network("1.0.0.0/8"), 100),
        (ipaddress.IPv4Network("2.0.0.0/8"), 200),
    ]
    a = write_asmap(tmp_path / "a.dat", entries)
    b = write_asmap(tmp_path / "b.dat", entries)

    result = diff_maps(a, b)

    assert result["total_changes"] == 0
    assert result["reassigned"] == 0
    assert result["newly_mapped"] == 0
    assert result["unmapped"] == 0
    assert result["top_movers"] == []


def test_classifies_reassignment(tmp_path):
    a = write_asmap(tmp_path / "a.dat", [(ipaddress.IPv4Network("1.0.0.0/8"), 100)])
    b = write_asmap(tmp_path / "b.dat", [(ipaddress.IPv4Network("1.0.0.0/8"), 200)])

    result = diff_maps(a, b)

    assert result["total_changes"] == 1
    assert result["reassigned"] == 1
    assert result["newly_mapped"] == 0
    assert result["unmapped"] == 0


def test_classifies_newly_mapped(tmp_path):
    a = write_asmap(tmp_path / "a.dat", [(ipaddress.IPv4Network("1.0.0.0/8"), 0)])
    b = write_asmap(tmp_path / "b.dat", [(ipaddress.IPv4Network("1.0.0.0/8"), 100)])

    result = diff_maps(a, b)

    assert result["newly_mapped"] == 1
    assert result["reassigned"] == 0
    assert result["unmapped"] == 0


def test_classifies_unmapped(tmp_path):
    a = write_asmap(tmp_path / "a.dat", [(ipaddress.IPv4Network("1.0.0.0/8"), 100)])
    b = write_asmap(tmp_path / "b.dat", [(ipaddress.IPv4Network("1.0.0.0/8"), 0)])

    result = diff_maps(a, b)

    assert result["unmapped"] == 1
    assert result["newly_mapped"] == 0
    assert result["reassigned"] == 0


def test_top_movers_ranked_with_primary_counterpart(tmp_path):
    # Use /8s that do not share a common parent prefix so the trie diff
    # records each prefix as its own change rather than collapsing
    # adjacent identical changes into a single shorter prefix.
    a = write_asmap(
        tmp_path / "a.dat",
        [
            (ipaddress.IPv4Network("1.0.0.0/8"), 100),
            (ipaddress.IPv4Network("16.0.0.0/8"), 100),
            (ipaddress.IPv4Network("64.0.0.0/8"), 100),
            (ipaddress.IPv4Network("128.0.0.0/8"), 200),
        ],
    )
    b = write_asmap(
        tmp_path / "b.dat",
        [
            (ipaddress.IPv4Network("1.0.0.0/8"), 999),
            (ipaddress.IPv4Network("16.0.0.0/8"), 999),
            (ipaddress.IPv4Network("64.0.0.0/8"), 999),
            (ipaddress.IPv4Network("128.0.0.0/8"), 200),
        ],
    )

    result = diff_maps(a, b)

    assert result["total_changes"] == 3
    top = result["top_movers"]
    assert top[0]["asn"] == 100 and top[0]["changes"] == 3
    assert top[0]["lost"] == 3 and top[0]["gained"] == 0
    assert top[0]["primary_counterpart"] == 999
    assert top[1]["asn"] == 999 and top[1]["primary_counterpart"] == 100
    assert top[1]["gained"] == 3 and top[1]["lost"] == 0


def test_bitcoin_node_impact_filters_to_addrs(tmp_path):
    a = write_asmap(
        tmp_path / "a.dat",
        [
            (ipaddress.IPv4Network("1.0.0.0/8"), 100),
            (ipaddress.IPv4Network("2.0.0.0/8"), 200),
        ],
    )
    b = write_asmap(
        tmp_path / "b.dat",
        [
            (ipaddress.IPv4Network("1.0.0.0/8"), 999),
            (ipaddress.IPv4Network("2.0.0.0/8"), 200),
        ],
    )
    addrs = tmp_path / "addrs.txt"
    addrs.write_text(
        "# header line\n"
        "\n"
        "1.2.3.4\n"
        "2.3.4.5\n"
        "not-an-ip\n"
        "1.50.60.70\n"
    )

    result = diff_maps(a, b, addrs_file=addrs)

    impact = result["bitcoin_node_impact"]
    assert impact["total_nodes"] == 3
    assert impact["reassigned"] == 2
    assert impact["total_affected"] == 2


def test_top_movers_capped_at_twentyfive(tmp_path):
    # Spread prefixes across the IPv4 space so every reassignment lands on a
    # distinct AS and gets its own row in changes_per_as.
    a_entries = [
        (ipaddress.IPv4Network(f"{octet}.0.0.0/16"), 1000 + octet)
        for octet in range(1, 60, 2)
    ]
    b_entries = [
        (ipaddress.IPv4Network(f"{octet}.0.0.0/16"), 9000 + octet)
        for octet in range(1, 60, 2)
    ]
    a = write_asmap(tmp_path / "a.dat", a_entries)
    b = write_asmap(tmp_path / "b.dat", b_entries)

    result = diff_maps(a, b)

    assert len(result["top_movers"]) == 25


def test_empty_maps_diff_to_no_changes(tmp_path):
    """Diffing two empty maps produces zero changes and no top movers."""
    a = write_asmap(tmp_path / "a.dat", [])
    b = write_asmap(tmp_path / "b.dat", [])

    result = diff_maps(a, b)

    assert result["entries_a"] == 0
    assert result["entries_b"] == 0
    assert result["total_changes"] == 0
    assert result["top_movers"] == []


def test_newly_mapped_asn_appears_in_top_movers_with_gained_only(tmp_path):
    """An ASN that only gains previously unmapped prefixes ranks with gained > 0, lost == 0."""
    a = write_asmap(
        tmp_path / "a.dat",
        [
            (ipaddress.IPv4Network("1.0.0.0/8"), 0),
            (ipaddress.IPv4Network("16.0.0.0/8"), 0),
        ],
    )
    b = write_asmap(
        tmp_path / "b.dat",
        [
            (ipaddress.IPv4Network("1.0.0.0/8"), 555),
            (ipaddress.IPv4Network("16.0.0.0/8"), 555),
        ],
    )

    result = diff_maps(a, b)

    assert result["newly_mapped"] == 2
    row = result["top_movers"][0]
    assert row["asn"] == 555
    assert row["changes"] == 2
    assert row["gained"] == 2
    assert row["lost"] == 0
    assert row["primary_counterpart"] == 0


def test_top_movers_record_gain_and_loss_for_reassigned_pair(tmp_path):
    """A reassignment between two ASes shows up as loss on one side and gain on the other."""
    a = write_asmap(
        tmp_path / "a.dat",
        [
            (ipaddress.IPv4Network("1.0.0.0/8"), 100),
            (ipaddress.IPv4Network("16.0.0.0/8"), 100),
        ],
    )
    b = write_asmap(
        tmp_path / "b.dat",
        [
            (ipaddress.IPv4Network("1.0.0.0/8"), 200),
            (ipaddress.IPv4Network("16.0.0.0/8"), 200),
        ],
    )

    result = diff_maps(a, b)

    by_asn = {row["asn"]: row for row in result["top_movers"]}
    assert by_asn[100]["gained"] == 0 and by_asn[100]["lost"] == 2
    assert by_asn[200]["gained"] == 2 and by_asn[200]["lost"] == 0
    assert by_asn[100]["primary_counterpart"] == 200
    assert by_asn[200]["primary_counterpart"] == 100
