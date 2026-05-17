"""Tests for asmap_dashboard.diff."""

from __future__ import annotations

import ipaddress
from collections import Counter

from asmap_dashboard.diff import (
    TOP_MOVERS_LIMIT,
    count_entries_per_asn,
    diff_loaded_maps,
    diff_maps,
)
from asmap_dashboard.loader import load_map

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
    # AS100 holds three /8 prefixes in map A and one (128.0.0.0/8)
    # in map B; AS999 is absent from A and holds three /8 prefixes
    # in B. The presence counts ride along on each row so the
    # frontend can render the "Touched" multiplier without a second
    # walk.
    assert top[0]["entries_in_a"] == 3 and top[0]["entries_in_b"] == 0
    assert top[1]["entries_in_a"] == 0 and top[1]["entries_in_b"] == 3


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


def test_top_movers_capped_at_limit(tmp_path):
    # Spread prefixes across the IPv4 space so every reassignment lands on a
    # distinct AS and gets its own row in changes_per_as. Generate strictly
    # more distinct ASes than TOP_MOVERS_LIMIT so the assertion exercises the
    # cap rather than the natural row count.
    overflow = 5
    target = TOP_MOVERS_LIMIT + overflow
    a_entries = [
        (ipaddress.IPv4Network(f"{index}.0.0.0/16"), 100_000 + index)
        for index in range(1, target + 1)
    ]
    b_entries = [
        (ipaddress.IPv4Network(f"{index}.0.0.0/16"), 900_000 + index)
        for index in range(1, target + 1)
    ]
    a = write_asmap(tmp_path / "a.dat", a_entries)
    b = write_asmap(tmp_path / "b.dat", b_entries)

    result = diff_maps(a, b)

    assert len(result["top_movers"]) == TOP_MOVERS_LIMIT


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


def test_diff_loaded_maps_matches_diff_maps(tmp_path):
    """The pipeline entry point must produce the same diff as the CLI one."""
    a = write_asmap(
        tmp_path / "a.dat",
        [
            (ipaddress.IPv4Network("1.0.0.0/8"), 100),
            (ipaddress.IPv4Network("16.0.0.0/8"), 100),
            (ipaddress.IPv4Network("64.0.0.0/8"), 0),
        ],
    )
    b = write_asmap(
        tmp_path / "b.dat",
        [
            (ipaddress.IPv4Network("1.0.0.0/8"), 200),
            (ipaddress.IPv4Network("16.0.0.0/8"), 100),
            (ipaddress.IPv4Network("64.0.0.0/8"), 300),
        ],
    )

    assert diff_loaded_maps(load_map(a), load_map(b)) == diff_maps(a, b)


def test_pre_computed_per_asn_counts_match_lazy_computation(tmp_path):
    """Passing pre-computed entries_per_asn must not change the diff payload."""
    a = write_asmap(
        tmp_path / "a.dat",
        [
            (ipaddress.IPv4Network("1.0.0.0/8"), 100),
            (ipaddress.IPv4Network("16.0.0.0/8"), 100),
            (ipaddress.IPv4Network("64.0.0.0/8"), 200),
        ],
    )
    b = write_asmap(
        tmp_path / "b.dat",
        [
            (ipaddress.IPv4Network("1.0.0.0/8"), 999),
            (ipaddress.IPv4Network("16.0.0.0/8"), 100),
            (ipaddress.IPv4Network("64.0.0.0/8"), 200),
        ],
    )
    loaded_a = load_map(a)
    loaded_b = load_map(b)

    lazy = diff_loaded_maps(loaded_a, loaded_b)
    eager = diff_loaded_maps(
        loaded_a,
        loaded_b,
        entries_per_asn_a=count_entries_per_asn(loaded_a),
        entries_per_asn_b=count_entries_per_asn(loaded_b),
    )

    assert lazy == eager


def test_address_family_split_sums_to_bucket_total(tmp_path):
    """reassigned_ipv4 + reassigned_ipv6 must equal reassigned (same for the other two buckets)."""
    a = write_asmap(
        tmp_path / "a.dat",
        [
            (ipaddress.IPv4Network("1.0.0.0/8"), 100),
            (ipaddress.IPv6Network("2001:db8::/32"), 200),
            (ipaddress.IPv4Network("16.0.0.0/8"), 300),
            (ipaddress.IPv6Network("2002:db8::/32"), 0),
        ],
    )
    b = write_asmap(
        tmp_path / "b.dat",
        [
            (ipaddress.IPv4Network("1.0.0.0/8"), 999),
            (ipaddress.IPv6Network("2001:db8::/32"), 998),
            (ipaddress.IPv4Network("16.0.0.0/8"), 0),
            (ipaddress.IPv6Network("2002:db8::/32"), 997),
        ],
    )

    result = diff_maps(a, b)

    assert (
        result["reassigned_ipv4"] + result["reassigned_ipv6"]
        == result["reassigned"]
    )
    assert (
        result["newly_mapped_ipv4"] + result["newly_mapped_ipv6"]
        == result["newly_mapped"]
    )
    assert (
        result["unmapped_ipv4"] + result["unmapped_ipv6"] == result["unmapped"]
    )
    # Concretely: two reassignments (one v4 one v6), one v6 newly
    # mapped, one v4 unmapped. The split must reflect that the
    # address family is read off the prefix itself, not derived
    # from the bucket totals.
    assert result["reassigned_ipv4"] == 1 and result["reassigned_ipv6"] == 1
    assert result["newly_mapped_ipv4"] == 0 and result["newly_mapped_ipv6"] == 1
    assert result["unmapped_ipv4"] == 1 and result["unmapped_ipv6"] == 0


def test_count_entries_per_asn_skips_asn_zero(tmp_path):
    """The sentinel ASN 0 must not appear in per-asn counts."""
    a = write_asmap(
        tmp_path / "a.dat",
        [
            (ipaddress.IPv4Network("1.0.0.0/8"), 100),
            (ipaddress.IPv4Network("16.0.0.0/8"), 100),
            (ipaddress.IPv4Network("64.0.0.0/8"), 0),
            (ipaddress.IPv4Network("128.0.0.0/8"), 200),
        ],
    )

    counts = count_entries_per_asn(load_map(a))

    assert counts == Counter({100: 2, 200: 1})
    assert 0 not in counts


def test_as_roster_delta_tracks_appearances_and_disappearances(tmp_path):
    """Map A holds ASes {100, 200, 300}; map B holds {200, 300, 400, 500}.

    The roster delta should report:
      - as_total_a = 3
      - as_total_b = 4
      - as_appeared = 2  (400 and 500 are new in B)
      - as_disappeared = 1  (100 is gone in B)
    """
    a = write_asmap(
        tmp_path / "a.dat",
        [
            (ipaddress.IPv4Network("1.0.0.0/8"), 100),
            (ipaddress.IPv4Network("16.0.0.0/8"), 200),
            (ipaddress.IPv4Network("64.0.0.0/8"), 300),
        ],
    )
    b = write_asmap(
        tmp_path / "b.dat",
        [
            (ipaddress.IPv4Network("1.0.0.0/8"), 400),
            (ipaddress.IPv4Network("16.0.0.0/8"), 200),
            (ipaddress.IPv4Network("64.0.0.0/8"), 300),
            (ipaddress.IPv4Network("128.0.0.0/8"), 500),
        ],
    )

    result = diff_maps(a, b)

    assert result["as_total_a"] == 3
    assert result["as_total_b"] == 4
    assert result["as_appeared"] == 2
    assert result["as_disappeared"] == 1
