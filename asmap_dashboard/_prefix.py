"""Bit-level helpers shared by ``analyze`` and ``diff``.

The vendored ``asmap.py`` stores IPv4 prefixes in the IPv6 trie at
``::ffff:0:0/96``; comparing the bit-list head avoids an ``ipaddress``
object per prefix in the diff loop.

Coverage is half-open integer ranges ``[start, end)`` in each family's
own space (so a map is a sorted list of disjoint ranges and a union is a
merge). The same ranges answer both "how many addresses" and "how many
NetGroup buckets" without materialising per-address sets a single IPv6
/16 would blow up.
"""

from __future__ import annotations

import ipaddress

from asmap_dashboard._vendor.asmap import net_to_prefix
from asmap_dashboard.netgroup import linked_ipv4

V4_MAPPED_HEAD: list[bool] = [False] * 80 + [True] * 16
IPV4_BITS = 32
IPV6_BITS = 128

# Core's GetGroup() buckets peers by /16 (IPv4) and /32 (IPv6) with no
# asmap; the match banner reports drift in those buckets. The shifts
# convert an address to its bucket index.
IPV4_BUCKET_BITS = 16
IPV6_BUCKET_BITS = 32
IPV4_BUCKET_SHIFT = IPV4_BITS - IPV4_BUCKET_BITS
IPV6_BUCKET_SHIFT = IPV6_BITS - IPV6_BUCKET_BITS


def is_ipv4_prefix(prefix: list[bool]) -> bool:
    """Return True if ``prefix`` lives under ``::ffff:0:0/96``."""
    if len(prefix) < 96:
        return False
    return prefix[:96] == V4_MAPPED_HEAD


def prefix_address_count(prefix: list[bool]) -> int:
    """Number of IP addresses this prefix covers.

    IPv4 prefixes carry the 96-bit ``::ffff:0:0/96`` head, so a v4 /24
    arrives as 120 bits and resolves to ``2**(32-24)``; native IPv6
    scales by its own length. Used to weight drift by real-world size.
    """
    if is_ipv4_prefix(prefix):
        return 1 << (IPV4_BITS - (len(prefix) - 96))
    return 1 << (IPV6_BITS - len(prefix))


def prefix_address_range(prefix: list[bool]) -> tuple[int, int]:
    """Half-open address range ``[start, end)`` of ``prefix``, in its own
    family space (v4-mapped head stripped to 32-bit, native IPv6 128-bit).
    Ranges from different families must never be merged together."""
    if is_ipv4_prefix(prefix):
        bits = prefix[96:]
        total_bits = IPV4_BITS
    else:
        bits = prefix
        total_bits = IPV6_BITS
    value = 0
    for bit in bits:
        value = (value << 1) | (1 if bit else 0)
    span = total_bits - len(bits)
    start = value << span
    return start, start + (1 << span)


def merge_ranges(ranges: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """Sort half-open ranges and coalesce overlaps and adjacencies.

    The result is the canonical form every consumer relies on:
    sorted, disjoint, non-adjacent. Computing the union of two
    coverages is just ``merge_ranges(list_a + list_b)``.
    """
    merged: list[tuple[int, int]] = []
    for start, end in sorted(ranges):
        if merged and start <= merged[-1][1]:
            if end > merged[-1][1]:
                merged[-1] = (merged[-1][0], end)
        else:
            merged.append((start, end))
    return merged


def total_range_size(ranges: list[tuple[int, int]]) -> int:
    """Total number of addresses covered by disjoint ``ranges``."""
    return sum(end - start for start, end in ranges)


def count_buckets(ranges: list[tuple[int, int]], shift: int) -> int:
    """Count distinct NetGroup buckets touched by merged ``ranges``.

    A bucket is ``address >> shift``; a partial cover still counts. Two
    consecutive ranges can touch the same bucket, which ``prev``
    deduplicates, so ``ranges`` must be in canonical ``merge_ranges`` form.
    """
    total = 0
    prev = -1
    for start, end in ranges:
        first = max(start >> shift, prev + 1)
        last = (end - 1) >> shift
        if last >= first:
            total += last - first + 1
            prev = last
    return total


def ip_to_prefix(ip: ipaddress._BaseAddress) -> list[bool]:
    """Full-length bit prefix ``ASMap.lookup`` expects.

    An IPv6 address transporting an IPv4 host (6to4, Teredo, NAT64) is
    looked up as that IPv4, matching Core's ``GetMappedAS()``. Single
    source for the diff ``--addrs`` path and the network metrics, so a
    tunneled peer scores identically in both.
    """
    if isinstance(ip, ipaddress.IPv6Address):
        ip = linked_ipv4(ip) or ip
    if isinstance(ip, ipaddress.IPv4Address):
        return net_to_prefix(ipaddress.IPv4Network((int(ip), 32)))
    return net_to_prefix(ipaddress.IPv6Network((int(ip), 128)))


def classify_asn_change(old_asn: int, new_asn: int) -> str | None:
    """Bucket one ASN transition into the three change categories (``0`` is
    the "no AS opinion" sentinel), or ``None`` when unchanged. Shared by
    ``diff`` and ``network.metrics`` so they classify identically."""
    if old_asn == new_asn:
        return None
    if old_asn == 0:
        return "newly_mapped"
    if new_asn == 0:
        return "unmapped"
    return "reassigned"
