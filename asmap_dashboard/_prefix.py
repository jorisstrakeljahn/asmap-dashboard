"""Bit-level helpers shared by ``analyze`` and ``diff``.

The vendored ``asmap.py`` stores IPv4 prefixes inside the IPv6 trie at
``::ffff:0:0/96`` (see its ``net_to_prefix``). Comparing the bit-list
head directly avoids allocating an ``ipaddress`` object per prefix,
which matters once the all-pairs diff loop runs against a real
history.

Coverage is represented as half-open integer ranges ``[start, end)``
of addresses within each family's own space (32-bit values for IPv4,
128-bit for IPv6). A prefix is one contiguous range, a map's mapped
space is a sorted list of disjoint ranges, and the union of two maps
is just another merge. The same ranges answer both questions the
pipeline asks: how many addresses (range sizes) and how many
NetGroup buckets (``count_buckets``) a coverage touches — without
ever materialising per-address or per-bucket sets, which a single
IPv6 /16 (2**16 /32 blocks) would blow up.
"""

from __future__ import annotations

import ipaddress

from asmap_dashboard._vendor.asmap import net_to_prefix
from asmap_dashboard.netgroup import linked_ipv4

V4_MAPPED_HEAD: list[bool] = [False] * 80 + [True] * 16
IPV4_BITS = 32
IPV6_BITS = 128

# Bitcoin Core's NetGroupManager::GetGroup() buckets peers by /16
# for IPv4 and /32 for IPv6 when no asmap is loaded. The diff
# explorer match banner reports both families in those buckets so
# the two columns read in the same peer-diversity vocabulary:
# "this many of the buckets Bitcoin Core would rely on for peer
# diversity carry a changed prefix". The shifts below convert an
# address to its bucket index.
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
    """Return the number of IP addresses this prefix covers.

    For an IPv4 prefix the trie length is offset by the 96-bit
    ``::ffff:0:0/96`` head, so a ``/24`` v4 prefix arrives here as a
    120-element bit list and resolves to ``2 ** (32 - 24) = 256``
    addresses. Native IPv6 prefixes scale by their own bit length.

    Used by ``analyze`` to summarise per-map address-space coverage and
    by ``diff`` to weight each changed prefix by its real-world size,
    so a single ``/8`` reassignment is no longer treated as one unit
    of drift alongside a single ``/48`` reassignment.
    """
    if is_ipv4_prefix(prefix):
        return 1 << (IPV4_BITS - (len(prefix) - 96))
    return 1 << (IPV6_BITS - len(prefix))


def prefix_address_range(prefix: list[bool]) -> tuple[int, int]:
    """Return the half-open address range ``[start, end)`` of ``prefix``.

    The range lives in the prefix's own family space: a v4-mapped
    prefix resolves to 32-bit values (the ``::ffff:0:0/96`` head is
    stripped), a native IPv6 prefix to 128-bit values. Ranges from
    different families must therefore never be merged together —
    the loader and the diff keep one list per family.
    """
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
    """Count distinct NetGroup buckets intersected by merged ``ranges``.

    A bucket is the value ``address >> shift`` (16 for IPv4 /16
    buckets, 96 for IPv6 /32 buckets). A range that covers a bucket
    only partially still counts it — a bucket "carries" a prefix as
    soon as one address inside it is involved. ``ranges`` must be in
    the canonical ``merge_ranges`` form; two consecutive ranges can
    still touch the same bucket (e.g. two /48s inside one /32 with a
    hole between them), which the ``prev`` cursor deduplicates.
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
    """Return the full-length bit prefix ``ASMap.lookup`` expects.

    An IPv6 address that merely transports an IPv4 host (6to4, Teredo,
    NAT64, ...) is looked up as that IPv4, matching Bitcoin Core's
    ``GetMappedAS()``. This is the single source for both the diff
    ``--addrs`` node-impact path and the live network metrics, so a
    tunneled peer scores against the same map entry in both; keeping
    two copies once let them diverge on the handful of tunneled peers
    per snapshot.
    """
    if isinstance(ip, ipaddress.IPv6Address):
        ip = linked_ipv4(ip) or ip
    if isinstance(ip, ipaddress.IPv4Address):
        return net_to_prefix(ipaddress.IPv4Network((int(ip), 32)))
    return net_to_prefix(ipaddress.IPv6Network((int(ip), 128)))


def classify_asn_change(old_asn: int, new_asn: int) -> str | None:
    """Bucket one ASN transition into the three change categories.

    ``0`` is the folded "no AS opinion" sentinel. Returns ``None`` when
    the ASN is unchanged. These are the same three buckets the Diff
    Explorer and the Network card both speak; sharing the branch keeps
    ``diff`` and ``network.metrics`` from drifting apart on the
    classification rule.
    """
    if old_asn == new_asn:
        return None
    if old_asn == 0:
        return "newly_mapped"
    if new_asn == 0:
        return "unmapped"
    return "reassigned"
