"""Bit-level helpers shared by ``analyze`` and ``diff``.

The vendored ``asmap.py`` stores IPv4 prefixes inside the IPv6 trie at
``::ffff:0:0/96`` (see its ``net_to_prefix``). Comparing the bit-list
head directly avoids allocating an ``ipaddress`` object per prefix,
which matters once the all-pairs diff loop runs against a real
history.
"""

from __future__ import annotations

from collections.abc import Iterator

V4_MAPPED_HEAD: list[bool] = [False] * 80 + [True] * 16
IPV4_BITS = 32
IPV6_BITS = 128

# Bitcoin Core's CNetAddr::GetGroup() puts every IPv4 peer into a
# /16 NetGroup bucket when no asmap is loaded. The diff explorer
# match banner reports the IPv4 side in those buckets so a reader
# can compare the v4 and v6 columns in the same peer-diversity
# vocabulary: ``ipv4_buckets_changed`` of ``ipv4_bucket_space``
# differ reads as "this many of the buckets Bitcoin Core would
# rely on for peer diversity carry a changed prefix".
IPV4_BUCKET_BITS = 16


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


def ipv4_bucket_indices(prefix: list[bool]) -> Iterator[int]:
    """Yield every /16 NetGroup bucket the IPv4 ``prefix`` covers.

    A /20 sits inside exactly one /16, a /14 spans four, a /8 spans
    256, and so on. The caller is expected to have already
    classified ``prefix`` as IPv4 via ``is_ipv4_prefix`` — passing
    anything else yields garbage. Bucket indices are plain ints in
    ``[0, 2**16)``, derived from the first 16 bits below the
    ``::ffff:0:0/96`` head.

    Implemented as a generator so ``/8`` and ``/0`` (256 and 65 536
    buckets respectively) do not materialise large intermediate
    sequences; callers fold the indices straight into a set.
    """
    v4_length = len(prefix) - 96
    if v4_length >= IPV4_BUCKET_BITS:
        # Prefix is strictly inside one /16. Read the first 16
        # bits below the v4-mapped head and emit that index.
        head = 0
        for bit in prefix[96 : 96 + IPV4_BUCKET_BITS]:
            head = (head << 1) | (1 if bit else 0)
        yield head
        return

    # Prefix is wider than a /16. The first ``v4_length`` bits are
    # fixed; the remaining ``IPV4_BUCKET_BITS - v4_length`` bits
    # range over all values, so we yield every index in that span.
    fixed_bits = 0
    for bit in prefix[96 : 96 + v4_length]:
        fixed_bits = (fixed_bits << 1) | (1 if bit else 0)
    span = IPV4_BUCKET_BITS - v4_length
    start = fixed_bits << span
    for offset in range(1 << span):
        yield start | offset
