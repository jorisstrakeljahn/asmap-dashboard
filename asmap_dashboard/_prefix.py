"""Bit-level helpers for the prefix lists asmap.py emits.

The vendored ``asmap.py`` (from bitcoin/bitcoin contrib/asmap/) stores
both address families in the same bit-prefix trie by remapping every
IPv4 prefix into the IPv4-mapped IPv6 range ::ffff:0:0/96. The diff
and analyze passes both need to bucket each prefix by address family
on the hot path, so the helpers below sit in one place rather than
diverging across modules.

Comparing the bit-list head directly is cheaper than calling
``prefix_to_net`` per entry, which would allocate an
``ipaddress.IPv4Network`` / ``IPv6Network`` for every prefix. The
all-pairs diff loop in ``metrics.py`` walks several million prefix
entries on a real asmap-data checkout, so the cheaper variant matters
once the upstream history grows past a handful of builds.
"""

from __future__ import annotations

# 80 zero bits followed by 16 one bits == ::ffff:0:0/96 in big-endian
# bit order. Any prefix that does not start with this exact head is
# native IPv6 (see ``net_to_prefix`` in the vendored asmap.py).
V4_MAPPED_HEAD: list[bool] = [False] * 80 + [True] * 16


def is_ipv4_prefix(prefix: list[bool]) -> bool:
    """Return True if ``prefix`` lives under ::ffff:0:0/96 (i.e. IPv4)."""
    if len(prefix) < 96:
        return False
    return prefix[:96] == V4_MAPPED_HEAD
