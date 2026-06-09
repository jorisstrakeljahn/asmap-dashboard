"""Tests for asmap_dashboard.loader."""

from __future__ import annotations

import dataclasses
import ipaddress

import pytest

from asmap_dashboard._vendor.asmap import ASMap
from asmap_dashboard.loader import LoadedMap, load_map

from .conftest import write_asmap


def test_load_map_returns_parsed_asmap_with_file_size(tmp_path):
    """A valid .dat file loads into a LoadedMap with the on-disk size."""
    path = write_asmap(
        tmp_path / "ok.dat",
        [(ipaddress.IPv4Network("1.0.0.0/8"), 100)],
    )

    loaded = load_map(path)

    assert isinstance(loaded, LoadedMap)
    assert isinstance(loaded.asmap, ASMap)
    assert loaded.file_size_bytes == path.stat().st_size


def test_load_map_caches_entries_count(tmp_path):
    """LoadedMap precomputes entries_count so diff loops avoid extra trie walks."""
    path = write_asmap(
        tmp_path / "three.dat",
        [
            (ipaddress.IPv4Network("1.0.0.0/8"), 100),
            (ipaddress.IPv4Network("2.0.0.0/8"), 200),
            (ipaddress.IPv6Network("2001::/16"), 300),
        ],
    )

    loaded = load_map(path)

    assert loaded.entries_count == len(loaded.asmap.to_entries())
    assert loaded.entries_count == 3


def test_load_map_raises_on_invalid_binary(tmp_path):
    path = tmp_path / "garbage.dat"
    path.write_bytes(b"\xff" * 32)

    with pytest.raises(ValueError):
        load_map(path)


def test_loaded_map_is_immutable(tmp_path):
    """LoadedMap is frozen so callers cannot mutate the cached state."""
    path = write_asmap(
        tmp_path / "ok.dat",
        [(ipaddress.IPv4Network("1.0.0.0/8"), 100)],
    )

    loaded = load_map(path)

    with pytest.raises(dataclasses.FrozenInstanceError):
        loaded.file_size_bytes = 0  # type: ignore[misc]


def test_load_map_caches_entries_per_asn_excluding_sentinel(tmp_path):
    """entries_per_asn carries every non-zero ASN exactly once with its count."""
    path = write_asmap(
        tmp_path / "mixed.dat",
        [
            (ipaddress.IPv4Network("1.0.0.0/8"), 100),
            (ipaddress.IPv4Network("16.0.0.0/8"), 100),
            (ipaddress.IPv4Network("64.0.0.0/8"), 0),
            (ipaddress.IPv4Network("128.0.0.0/8"), 200),
        ],
    )

    loaded = load_map(path)

    assert dict(loaded.entries_per_asn) == {100: 2, 200: 1}
    assert 0 not in loaded.entries_per_asn


def test_load_map_caches_per_asn_address_space_split_by_family(tmp_path):
    """ipv{4,6}_addresses_per_asn sum to the headline ipv{4,6}_address_space."""
    path = write_asmap(
        tmp_path / "split.dat",
        [
            (ipaddress.IPv4Network("1.0.0.0/8"), 100),
            (ipaddress.IPv4Network("16.0.0.0/8"), 200),
            (ipaddress.IPv6Network("2001::/16"), 100),
            (ipaddress.IPv6Network("2a00::/16"), 300),
        ],
    )

    loaded = load_map(path)

    assert loaded.ipv4_addresses_per_asn[100] == 1 << (32 - 8)
    assert loaded.ipv4_addresses_per_asn[200] == 1 << (32 - 8)
    assert loaded.ipv6_addresses_per_asn[100] == 1 << (128 - 16)
    assert loaded.ipv6_addresses_per_asn[300] == 1 << (128 - 16)
    # Sum invariant: per-AS coverage and the headline drift
    # denominator can never disagree on the same map.
    assert sum(loaded.ipv4_addresses_per_asn.values()) == loaded.ipv4_address_space
    assert sum(loaded.ipv6_addresses_per_asn.values()) == loaded.ipv6_address_space


def test_load_map_per_asn_address_space_excludes_sentinel_zero(tmp_path):
    """Per-AS coverage Counters must not carry an ASN-0 entry."""
    path = write_asmap(
        tmp_path / "with-zero.dat",
        [
            (ipaddress.IPv4Network("1.0.0.0/8"), 100),
            (ipaddress.IPv4Network("2.0.0.0/8"), 0),
            (ipaddress.IPv6Network("2a00::/16"), 0),
        ],
    )

    loaded = load_map(path)

    assert 0 not in loaded.ipv4_addresses_per_asn
    assert 0 not in loaded.ipv6_addresses_per_asn
    assert loaded.ipv4_address_space == 1 << (32 - 8)
    assert loaded.ipv6_address_space == 0


def test_load_map_caches_merged_address_ranges_per_family(tmp_path):
    """Address ranges are sorted, disjoint, family-split, ASN-0-free.

    The three adjacent /24s (different ASNs, so they survive as
    separate trie entries) must coalesce into one contiguous range;
    the ASN-0 prefix and the IPv6 entry must not leak into the
    IPv4 list.
    """
    path = write_asmap(
        tmp_path / "ranges.dat",
        [
            (ipaddress.IPv4Network("10.0.0.0/24"), 100),
            (ipaddress.IPv4Network("10.0.1.0/24"), 200),
            (ipaddress.IPv4Network("10.0.2.0/24"), 300),
            (ipaddress.IPv4Network("1.0.0.0/8"), 400),
            (ipaddress.IPv4Network("48.0.0.0/16"), 0),
            (ipaddress.IPv6Network("2001::/16"), 500),
        ],
    )

    loaded = load_map(path)

    ten_base = int(ipaddress.IPv4Address("10.0.0.0"))
    assert loaded.ipv4_address_ranges == (
        (1 << 24, 2 << 24),
        (ten_base, ten_base + 3 * 256),
    )
    v6_base = int(ipaddress.IPv6Address("2001::"))
    assert loaded.ipv6_address_ranges == ((v6_base, v6_base + (1 << 112)),)


def test_load_map_address_ranges_sum_to_address_space(tmp_path):
    """The ranges and the headline space totals describe the same coverage."""
    path = write_asmap(
        tmp_path / "sum.dat",
        [
            (ipaddress.IPv4Network("1.0.0.0/8"), 100),
            (ipaddress.IPv4Network("16.0.0.0/24"), 200),
            (ipaddress.IPv6Network("2001::/16"), 300),
            (ipaddress.IPv6Network("2a00::/48"), 400),
        ],
    )

    loaded = load_map(path)

    assert (
        sum(end - start for start, end in loaded.ipv4_address_ranges)
        == loaded.ipv4_address_space
    )
    assert (
        sum(end - start for start, end in loaded.ipv6_address_ranges)
        == loaded.ipv6_address_space
    )
