"""Tests for asmap_dashboard.diff."""

from __future__ import annotations

import ipaddress

import pytest

from asmap_dashboard.diff import (
    TOP_MOVERS_LIMIT,
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


@pytest.mark.parametrize(
    ("old_asn", "new_asn", "bucket"),
    [
        (100, 200, "reassigned"),
        (0, 100, "newly_mapped"),
        (100, 0, "unmapped"),
    ],
)
def test_single_prefix_change_classified(tmp_path, old_asn, new_asn, bucket):
    """One prefix changing ASN lands in exactly one classification bucket."""
    a = write_asmap(tmp_path / "a.dat", [(ipaddress.IPv4Network("1.0.0.0/8"), old_asn)])
    b = write_asmap(tmp_path / "b.dat", [(ipaddress.IPv4Network("1.0.0.0/8"), new_asn)])

    result = diff_maps(a, b)

    assert result["total_changes"] == 1
    buckets = {"reassigned", "newly_mapped", "unmapped"}
    assert result[bucket] == 1
    for other in buckets - {bucket}:
        assert result[other] == 0


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
    eighth = 1 << (32 - 8)
    assert top[0]["asn"] == 100 and top[0]["changes"] == 3
    assert top[0]["ipv4_addresses_lost"] == 3 * eighth
    assert top[0]["ipv4_addresses_gained"] == 0
    assert top[0]["ipv4_primary_counterpart"] == 999
    assert top[1]["asn"] == 999 and top[1]["ipv4_primary_counterpart"] == 100
    assert top[1]["ipv4_addresses_gained"] == 3 * eighth
    assert top[1]["ipv4_addresses_lost"] == 0
    # AS100 holds three /8 prefixes in map A and one (128.0.0.0/8)
    # in map B; AS999 is absent from A and holds three /8 prefixes
    # in B. The presence coverage rides along on each row so the
    # frontend can render the "Touched" multiplier without a second
    # walk.
    assert top[0]["ipv4_addresses_in_a"] == 3 * eighth
    assert top[0]["ipv4_addresses_in_b"] == 0
    assert top[1]["ipv4_addresses_in_a"] == 0
    assert top[1]["ipv4_addresses_in_b"] == 3 * eighth


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
    addrs.write_text("# header line\n\n1.2.3.4\n2.3.4.5\nnot-an-ip\n1.50.60.70\n")

    result = diff_maps(a, b, addrs_file=addrs)

    impact = result["bitcoin_node_impact"]
    assert impact["total_nodes"] == 3
    assert impact["reassigned"] == 2
    assert impact["total_affected"] == 2


def test_bitcoin_node_impact_unwraps_tunneled_ipv6(tmp_path):
    """A tunneled IPv6 peer scores against the IPv4 entry it transports.

    6to4 ``2002:0102:0304::1`` embeds 1.2.3.4. Bitcoin Core's
    GetMappedAS() and the live network metrics both resolve such a peer
    through the map as that IPv4, so node impact must do the same rather
    than looking up the (unmapped) v6 wrapper and scoring it as no-change.
    """
    a = write_asmap(tmp_path / "a.dat", [(ipaddress.IPv4Network("1.0.0.0/8"), 100)])
    b = write_asmap(tmp_path / "b.dat", [(ipaddress.IPv4Network("1.0.0.0/8"), 999)])
    addrs = tmp_path / "addrs.txt"
    addrs.write_text("2002:0102:0304::1\n")

    impact = diff_maps(a, b, addrs_file=addrs)["bitcoin_node_impact"]

    assert impact["total_nodes"] == 1
    assert impact["reassigned"] == 1


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
    assert row["ipv4_addresses_gained"] == 2 * (1 << (32 - 8))
    assert row["ipv4_addresses_lost"] == 0
    assert row["ipv4_primary_counterpart"] == 0


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

    assert result["reassigned_ipv4"] + result["reassigned_ipv6"] == result["reassigned"]
    assert (
        result["newly_mapped_ipv4"] + result["newly_mapped_ipv6"]
        == result["newly_mapped"]
    )
    assert result["unmapped_ipv4"] + result["unmapped_ipv6"] == result["unmapped"]
    # Concretely: two reassignments (one v4 one v6), one v6 newly
    # mapped, one v4 unmapped. The split must reflect that the
    # address family is read off the prefix itself, not derived
    # from the bucket totals.
    assert result["reassigned_ipv4"] == 1 and result["reassigned_ipv6"] == 1
    assert result["newly_mapped_ipv4"] == 0 and result["newly_mapped_ipv6"] == 1
    assert result["unmapped_ipv4"] == 1 and result["unmapped_ipv6"] == 0


def test_coverage_weights_changes_by_prefix_address_count(tmp_path):
    """Each bucket's coverage field equals the sum of prefix sizes, by family.

    Map A: one /8 IPv4 (AS100) and one /16 IPv6 (AS200).
    Map B: same prefixes, different ASNs (AS999 and AS888).

    The reassignment must weigh the full /8 (16 777 216 IPv4
    addresses) and the full /16 (2^(128-16) IPv6 addresses), not
    just two entry rows.
    """
    a = write_asmap(
        tmp_path / "a.dat",
        [
            (ipaddress.IPv4Network("1.0.0.0/8"), 100),
            (ipaddress.IPv6Network("2001::/16"), 200),
        ],
    )
    b = write_asmap(
        tmp_path / "b.dat",
        [
            (ipaddress.IPv4Network("1.0.0.0/8"), 999),
            (ipaddress.IPv6Network("2001::/16"), 888),
        ],
    )

    result = diff_maps(a, b)

    assert result["reassigned"] == 2
    assert result["reassigned_ipv4_addresses"] == 1 << (32 - 8)
    assert result["reassigned_ipv6_addresses"] == 1 << (128 - 16)
    assert result["newly_mapped_ipv4_addresses"] == 0
    assert result["newly_mapped_ipv6_addresses"] == 0
    assert result["unmapped_ipv4_addresses"] == 0
    assert result["unmapped_ipv6_addresses"] == 0


def test_coverage_totals_sum_per_family_buckets(tmp_path):
    """ipv4_addresses_changed = reassigned + newly_mapped + unmapped, per family."""
    a = write_asmap(
        tmp_path / "a.dat",
        [
            (ipaddress.IPv4Network("1.0.0.0/8"), 100),
            (ipaddress.IPv4Network("16.0.0.0/8"), 0),
            (ipaddress.IPv4Network("32.0.0.0/8"), 300),
            (ipaddress.IPv6Network("2001::/16"), 400),
        ],
    )
    b = write_asmap(
        tmp_path / "b.dat",
        [
            (ipaddress.IPv4Network("1.0.0.0/8"), 999),
            (ipaddress.IPv4Network("16.0.0.0/8"), 500),
            (ipaddress.IPv4Network("32.0.0.0/8"), 0),
            (ipaddress.IPv6Network("2001::/16"), 0),
        ],
    )

    result = diff_maps(a, b)

    assert result["ipv4_addresses_changed"] == (
        result["reassigned_ipv4_addresses"]
        + result["newly_mapped_ipv4_addresses"]
        + result["unmapped_ipv4_addresses"]
    )
    assert result["ipv6_addresses_changed"] == (
        result["reassigned_ipv6_addresses"]
        + result["newly_mapped_ipv6_addresses"]
        + result["unmapped_ipv6_addresses"]
    )


def test_coverage_distinguishes_large_and_small_prefix_reassignments(tmp_path):
    """A /8 and a /24 reassignment count as one entry each but differ 65 536x in coverage."""
    a = write_asmap(
        tmp_path / "a.dat",
        [
            (ipaddress.IPv4Network("1.0.0.0/8"), 100),
            (ipaddress.IPv4Network("128.0.0.0/24"), 200),
        ],
    )
    b = write_asmap(
        tmp_path / "b.dat",
        [
            (ipaddress.IPv4Network("1.0.0.0/8"), 999),
            (ipaddress.IPv4Network("128.0.0.0/24"), 888),
        ],
    )

    result = diff_maps(a, b)

    # Entry view: two reassignments.
    assert result["reassigned"] == 2
    # Coverage view: the /8 dwarfs the /24 by exactly 2^16 = 65 536.
    big = 1 << (32 - 8)
    small = 1 << (32 - 24)
    assert result["reassigned_ipv4_addresses"] == big + small
    assert big // small == 65_536


def test_coverage_includes_union_address_space_denominators(tmp_path):
    """ipv{4,6}_address_space_union carry the union totals for frontend ratios.

    The 1.0.0.0/8 and 2001::/16 are mapped by both maps and must
    count once, not twice — the union is a coverage merge, not a
    sum of the two maps' totals.
    """
    a = write_asmap(
        tmp_path / "a.dat",
        [
            (ipaddress.IPv4Network("1.0.0.0/8"), 100),
            (ipaddress.IPv6Network("2001::/16"), 200),
        ],
    )
    b = write_asmap(
        tmp_path / "b.dat",
        [
            (ipaddress.IPv4Network("1.0.0.0/8"), 100),
            (ipaddress.IPv4Network("2.0.0.0/8"), 300),
            (ipaddress.IPv6Network("2001::/16"), 200),
        ],
    )

    result = diff_maps(a, b)

    assert result["ipv4_address_space_union"] == 2 * (1 << (32 - 8))
    assert result["ipv6_address_space_union"] == 1 << (128 - 16)


def test_ipv4_buckets_changed_counts_each_sixteen_once(tmp_path):
    """A /20 reassignment touches exactly one /16 NetGroup bucket.

    Two reassignments inside the same /16 should still collapse
    to one bucket — the banner reads "buckets carrying at least
    one change", not "changes weighted by buckets".
    """
    a = write_asmap(
        tmp_path / "a.dat",
        [
            (ipaddress.IPv4Network("10.0.0.0/20"), 100),
            (ipaddress.IPv4Network("10.0.16.0/20"), 100),
        ],
    )
    b = write_asmap(
        tmp_path / "b.dat",
        [
            (ipaddress.IPv4Network("10.0.0.0/20"), 999),
            (ipaddress.IPv4Network("10.0.16.0/20"), 888),
        ],
    )

    result = diff_maps(a, b)

    assert result["reassigned_ipv4"] == 2
    assert result["ipv4_buckets_changed"] == 1


def test_ipv4_buckets_changed_expands_wide_prefixes(tmp_path):
    """A /8 reassignment touches all 256 /16 buckets it covers."""
    a = write_asmap(
        tmp_path / "a.dat",
        [(ipaddress.IPv4Network("1.0.0.0/8"), 100)],
    )
    b = write_asmap(
        tmp_path / "b.dat",
        [(ipaddress.IPv4Network("1.0.0.0/8"), 999)],
    )

    result = diff_maps(a, b)

    assert result["reassigned_ipv4"] == 1
    assert result["ipv4_buckets_changed"] == 256


def test_ipv4_buckets_changed_unions_across_change_kinds(tmp_path):
    """Reassign + new-map + unmap buckets must all merge into one set.

    Three distinct /16-resident prefixes change in three different
    ways. Each contributes one /16; nothing overlaps. The result
    must be exactly three.
    """
    a = write_asmap(
        tmp_path / "a.dat",
        [
            (ipaddress.IPv4Network("10.0.0.0/24"), 100),
            (ipaddress.IPv4Network("20.0.0.0/24"), 200),
        ],
    )
    b = write_asmap(
        tmp_path / "b.dat",
        [
            (ipaddress.IPv4Network("10.0.0.0/24"), 999),
            (ipaddress.IPv4Network("30.0.0.0/24"), 300),
        ],
    )

    result = diff_maps(a, b)

    assert result["reassigned_ipv4"] == 1
    assert result["newly_mapped_ipv4"] == 1
    assert result["unmapped_ipv4"] == 1
    assert result["ipv4_buckets_changed"] == 3


def test_diff_carries_ipv4_bucket_space_union(tmp_path):
    """ipv4_bucket_space_union deduplicates buckets both maps cover.

    Map A has one /8 (256 buckets); Map B has the same /8 plus
    another (256 further buckets). The shared /8 counts once:
    256 + 256, not 256 + 512.
    """
    a = write_asmap(
        tmp_path / "a.dat",
        [(ipaddress.IPv4Network("1.0.0.0/8"), 100)],
    )
    b = write_asmap(
        tmp_path / "b.dat",
        [
            (ipaddress.IPv4Network("1.0.0.0/8"), 100),
            (ipaddress.IPv4Network("128.0.0.0/8"), 200),
        ],
    )

    result = diff_maps(a, b)

    assert result["ipv4_bucket_space_union"] == 512
    # The newly mapped /8 only exists in Map B's coverage. With a
    # per-map denominator the changed buckets could outgrow it; the
    # union contains them by construction.
    assert result["ipv4_buckets_changed"] == 256
    assert result["ipv4_buckets_changed"] <= result["ipv4_bucket_space_union"]


def test_ipv6_blocks_changed_counts_thirtytwo_blocks_once(tmp_path):
    """IPv6 changes count in /32 NetGroup blocks, deduplicated.

    Two /48 reassignments inside the same /32 collapse to one
    block; a third /48 in a different /32 adds a second. Mirrors
    the IPv4 bucket semantics so the match banner's two columns
    read identically.
    """
    a = write_asmap(
        tmp_path / "a.dat",
        [
            (ipaddress.IPv6Network("2001:db8::/48"), 100),
            (ipaddress.IPv6Network("2001:db8:1::/48"), 100),
            (ipaddress.IPv6Network("2a00::/48"), 100),
        ],
    )
    b = write_asmap(
        tmp_path / "b.dat",
        [
            (ipaddress.IPv6Network("2001:db8::/48"), 999),
            (ipaddress.IPv6Network("2001:db8:1::/48"), 888),
            (ipaddress.IPv6Network("2a00::/48"), 777),
        ],
    )

    result = diff_maps(a, b)

    assert result["reassigned_ipv6"] == 3
    assert result["ipv6_blocks_changed"] == 2


def test_ipv6_block_space_union_expands_wide_prefixes(tmp_path):
    """A /16 spans 2^16 /32 blocks; sub-/32 coverage still counts its block.

    Also pins the changed-within-union invariant on the IPv6 side:
    the /16 is reassigned wholesale, so changed blocks equal the
    /16's full block span while the union additionally carries the
    untouched 2a00::/48's block.
    """
    a = write_asmap(
        tmp_path / "a.dat",
        [
            (ipaddress.IPv6Network("2001::/16"), 100),
            (ipaddress.IPv6Network("2a00::/48"), 200),
        ],
    )
    b = write_asmap(
        tmp_path / "b.dat",
        [
            (ipaddress.IPv6Network("2001::/16"), 999),
            (ipaddress.IPv6Network("2a00::/48"), 200),
        ],
    )

    result = diff_maps(a, b)

    assert result["ipv6_blocks_changed"] == 1 << 16
    assert result["ipv6_block_space_union"] == (1 << 16) + 1
    assert result["ipv6_blocks_changed"] <= result["ipv6_block_space_union"]


def test_top_movers_row_carries_coverage_in_both_families(tmp_path):
    """Every top_movers row exposes the entry total plus IPv4 and IPv6 coverage."""
    a = write_asmap(
        tmp_path / "a.dat",
        [
            (ipaddress.IPv4Network("1.0.0.0/8"), 100),
            (ipaddress.IPv6Network("2001::/16"), 100),
        ],
    )
    b = write_asmap(
        tmp_path / "b.dat",
        [
            (ipaddress.IPv4Network("1.0.0.0/8"), 200),
            (ipaddress.IPv6Network("2001::/16"), 200),
        ],
    )

    result = diff_maps(a, b)
    rows = {row["asn"]: row for row in result["top_movers"]}

    # AS100 lost a /8 IPv4 and a /16 IPv6 to AS200.
    losing = rows[100]
    assert losing["changes"] == 2
    assert losing["ipv4_addresses_lost"] == 1 << (32 - 8)
    assert losing["ipv4_addresses_gained"] == 0
    assert losing["ipv4_addresses_changed"] == 1 << (32 - 8)
    assert losing["ipv6_addresses_lost"] == 1 << (128 - 16)
    assert losing["ipv6_addresses_gained"] == 0
    assert losing["ipv6_addresses_changed"] == 1 << (128 - 16)

    gaining = rows[200]
    assert gaining["ipv4_addresses_gained"] == 1 << (32 - 8)
    assert gaining["ipv4_addresses_lost"] == 0
    assert gaining["ipv6_addresses_gained"] == 1 << (128 - 16)
    assert gaining["ipv6_addresses_lost"] == 0


def test_top_movers_per_as_coverage_sums_to_global_totals(tmp_path):
    """Sum of per-AS gained coverage == global ipv{4,6}_addresses_changed.

    Equivalently for lost. Together this guarantees the per-AS view and
    the headline drift number cannot drift apart on the same diff.
    """
    a = write_asmap(
        tmp_path / "a.dat",
        [
            (ipaddress.IPv4Network("1.0.0.0/8"), 100),
            (ipaddress.IPv4Network("16.0.0.0/8"), 200),
            (ipaddress.IPv4Network("32.0.0.0/24"), 300),
            (ipaddress.IPv6Network("2001::/16"), 400),
            (ipaddress.IPv6Network("2a00::/24"), 0),
        ],
    )
    b = write_asmap(
        tmp_path / "b.dat",
        [
            (ipaddress.IPv4Network("1.0.0.0/8"), 999),
            (ipaddress.IPv4Network("16.0.0.0/8"), 888),
            (ipaddress.IPv4Network("32.0.0.0/24"), 0),
            (ipaddress.IPv6Network("2001::/16"), 777),
            (ipaddress.IPv6Network("2a00::/24"), 666),
        ],
    )

    result = diff_maps(a, b)
    rows = result["top_movers"]

    # Every reassignment is one AS gaining and another losing, so it
    # contributes to both gained and lost. Newly-mapped prefixes only
    # contribute to gained (no AS lost them). Unmapped prefixes only
    # contribute to lost (no AS gained them). The per-AS coverage view
    # therefore reconstructs the headline bucket sums exactly.
    ipv4_gained = sum(row["ipv4_addresses_gained"] for row in rows)
    ipv4_lost = sum(row["ipv4_addresses_lost"] for row in rows)
    assert ipv4_gained == (
        result["reassigned_ipv4_addresses"] + result["newly_mapped_ipv4_addresses"]
    )
    assert ipv4_lost == (
        result["reassigned_ipv4_addresses"] + result["unmapped_ipv4_addresses"]
    )

    ipv6_gained = sum(row["ipv6_addresses_gained"] for row in rows)
    ipv6_lost = sum(row["ipv6_addresses_lost"] for row in rows)
    assert ipv6_gained == (
        result["reassigned_ipv6_addresses"] + result["newly_mapped_ipv6_addresses"]
    )
    assert ipv6_lost == (
        result["reassigned_ipv6_addresses"] + result["unmapped_ipv6_addresses"]
    )


def test_top_movers_per_as_presence_matches_loader_caches(tmp_path):
    """*_in_a / *_in_b fields read straight off the cached loader counters."""
    a = write_asmap(
        tmp_path / "a.dat",
        [
            (ipaddress.IPv4Network("1.0.0.0/8"), 100),
            (ipaddress.IPv4Network("16.0.0.0/8"), 100),
            (ipaddress.IPv6Network("2001::/16"), 100),
        ],
    )
    b = write_asmap(
        tmp_path / "b.dat",
        [
            (ipaddress.IPv4Network("1.0.0.0/8"), 200),
            (ipaddress.IPv4Network("16.0.0.0/8"), 100),
            (ipaddress.IPv6Network("2001::/16"), 100),
        ],
    )
    loaded_a = load_map(a)
    loaded_b = load_map(b)
    result = diff_loaded_maps(loaded_a, loaded_b)

    rows = {row["asn"]: row for row in result["top_movers"]}
    # AS100 in A: two IPv4 /8s + one IPv6 /16. In B: one IPv4 /8 +
    # one IPv6 /16 (the second /8 was reassigned to AS200).
    assert rows[100]["ipv4_addresses_in_a"] == 2 * (1 << (32 - 8))
    assert rows[100]["ipv4_addresses_in_b"] == 1 << (32 - 8)
    assert rows[100]["ipv6_addresses_in_a"] == 1 << (128 - 16)
    assert rows[100]["ipv6_addresses_in_b"] == 1 << (128 - 16)
    # Cross-check: the row reads the same counter the loader cached.
    assert rows[100]["ipv4_addresses_in_a"] == loaded_a.ipv4_addresses_per_asn[100]
    assert rows[100]["ipv6_addresses_in_b"] == loaded_b.ipv6_addresses_per_asn[100]


def test_top_movers_ipv6_dominant_as_appears_via_union_ranking(tmp_path):
    """An IPv6-heavy AS that loses on entries still ranks via the v6 currency.

    Set-up: AS100 reassigns a single IPv6 /16 (one entry, but 2^112
    addresses). AS200 reassigns one IPv4 /16 (one entry, 65 536
    addresses). AS300 reassigns one IPv4 /16 as well.

    Under entries, ties go to insertion order. Under IPv6 coverage,
    AS100 dwarfs every IPv4 mover by ~10^28. The union top-N must
    surface AS100 regardless of the entries ranking, because the
    frontend's IPv6 picker would otherwise render an empty table.
    """
    a = write_asmap(
        tmp_path / "a.dat",
        [
            (ipaddress.IPv6Network("2001::/16"), 100),
            (ipaddress.IPv4Network("1.0.0.0/16"), 200),
            (ipaddress.IPv4Network("2.0.0.0/16"), 300),
        ],
    )
    b = write_asmap(
        tmp_path / "b.dat",
        [
            (ipaddress.IPv6Network("2001::/16"), 999),
            (ipaddress.IPv4Network("1.0.0.0/16"), 888),
            (ipaddress.IPv4Network("2.0.0.0/16"), 777),
        ],
    )

    result = diff_maps(a, b)
    asns_in_top = {row["asn"] for row in result["top_movers"]}

    # The v6-dominant losing AS (100) and gaining AS (999) must be
    # in the union, even though they share an entries-rank with
    # the IPv4 movers (AS200, AS300, AS888, AS777).
    assert {100, 999} <= asns_in_top
    assert {200, 300, 888, 777} <= asns_in_top


def test_top_movers_primary_counterpart_is_address_weighted(tmp_path):
    """ipv4_primary_counterpart picks the partner by address space, not entries.

    AS100 reassigns:
      - 10 IPv4 /24 prefixes to AS200 (10 entries, 10*256 = 2560 v4 addr)
      - 1 IPv4 /8 to AS300 (1 entry, 2^24 = 16M v4 addr)

    AS200 receives far more entries, but AS300 receives ~6500x the
    address space — the rendered counterpart must be AS300.
    """
    a_entries = [(ipaddress.IPv4Network(f"10.{i}.0.0/24"), 100) for i in range(10)]
    a_entries.append((ipaddress.IPv4Network("64.0.0.0/8"), 100))
    a = write_asmap(tmp_path / "a.dat", a_entries)

    b_entries = [(ipaddress.IPv4Network(f"10.{i}.0.0/24"), 200) for i in range(10)]
    b_entries.append((ipaddress.IPv4Network("64.0.0.0/8"), 300))
    b = write_asmap(tmp_path / "b.dat", b_entries)

    result = diff_maps(a, b)
    losing = next(row for row in result["top_movers"] if row["asn"] == 100)

    assert losing["ipv4_primary_counterpart"] == 300


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
