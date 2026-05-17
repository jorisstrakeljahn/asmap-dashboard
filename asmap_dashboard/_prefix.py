"""Bit-level helpers shared by ``analyze`` and ``diff``.

The vendored ``asmap.py`` stores IPv4 prefixes inside the IPv6 trie at
``::ffff:0:0/96`` (see its ``net_to_prefix``). Comparing the bit-list
head directly avoids allocating an ``ipaddress`` object per prefix,
which matters once the all-pairs diff loop runs against a real
history.
"""

from __future__ import annotations

V4_MAPPED_HEAD: list[bool] = [False] * 80 + [True] * 16


def is_ipv4_prefix(prefix: list[bool]) -> bool:
    """Return True if ``prefix`` lives under ``::ffff:0:0/96``."""
    if len(prefix) < 96:
        return False
    return prefix[:96] == V4_MAPPED_HEAD
