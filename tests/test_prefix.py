"""Tests for the range helpers in asmap_dashboard._prefix.

The loader and diff tests cover these helpers end-to-end through
real ASmap binaries; the cases here pin the edge behaviour that is
hard to reach that way (bucket dedup across ranges with a hole,
family offsets in prefix_address_range).
"""

from __future__ import annotations

import ipaddress

from asmap_dashboard._prefix import (
    count_buckets,
    merge_ranges,
    prefix_address_range,
    total_range_size,
)
from asmap_dashboard._vendor.asmap import net_to_prefix


def test_prefix_address_range_strips_the_v4_mapped_head():
    """An IPv4 prefix resolves to 32-bit values, not 128-bit ones."""
    start, end = prefix_address_range(
        net_to_prefix(ipaddress.IPv4Network("1.2.0.0/16"))
    )

    assert start == int(ipaddress.IPv4Address("1.2.0.0"))
    assert end == start + (1 << 16)


def test_prefix_address_range_keeps_native_ipv6_width():
    start, end = prefix_address_range(
        net_to_prefix(ipaddress.IPv6Network("2001:db8::/48"))
    )

    assert start == int(ipaddress.IPv6Address("2001:db8::"))
    assert end == start + (1 << 80)


def test_merge_ranges_coalesces_overlap_and_adjacency():
    """Overlapping and back-to-back ranges fold; gapped ones stay apart."""
    merged = merge_ranges([(40, 50), (0, 10), (10, 20), (15, 25)])

    assert merged == [(0, 25), (40, 50)]
    assert total_range_size(merged) == 35


def test_count_buckets_counts_partial_buckets_once():
    """A range that only grazes a bucket still claims it whole."""
    # Bucket size 256 (shift 8): [200, 300) touches buckets 0 and 1.
    assert count_buckets([(200, 300)], 8) == 2


def test_count_buckets_dedups_ranges_sharing_a_bucket():
    """Two ranges with a hole between them can sit in one bucket.

    merge_ranges keeps them separate (they are not adjacent), so
    count_buckets has to notice the second range starts in a bucket
    it already counted.
    """
    ranges = merge_ranges([(0x10, 0x20), (0x40, 0x50), (0x300, 0x310)])

    assert ranges == [(0x10, 0x20), (0x40, 0x50), (0x300, 0x310)]
    assert count_buckets(ranges, 8) == 2
