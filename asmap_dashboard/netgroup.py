"""Default Bitcoin Core NetGroup buckets for IPv4 and IPv6 addresses.

This is the baseline that Bitcoin Core's GetGroup() falls back on
when no ASmap is loaded. The dashboard compares it against the
ASmap-derived NetGroup count to quantify the diversity gain ASmap
provides over plain prefix bucketing.

Rules, mirrored from src/netaddress.cpp in Bitcoin Core:
  - IPv4 addresses bucket by /16.
  - IPv6 addresses inside Hurricane Electric's 2001:470::/32 tunnel
    range bucket by /36, so the dozen-or-so /36 sub-allocations
    inside HE.net do not collapse into a single /32 group.
  - All other IPv6 addresses bucket by /32.
"""

from __future__ import annotations

import ipaddress
from typing import Union

IPV4_BUCKET_BITS = 16
IPV6_BUCKET_BITS = 32
HENET_BUCKET_BITS = 36

HENET_NETWORK = ipaddress.IPv6Network("2001:470::/32")

IPAddress = Union[ipaddress.IPv4Address, ipaddress.IPv6Address]
NetGroup = Union[ipaddress.IPv4Network, ipaddress.IPv6Network]


def default_netgroup(ip: Union[str, IPAddress]) -> NetGroup:
    """Return the network bucket Bitcoin Core's GetGroup() would assign.

    The result is hashable, so it can be used directly as a dict or set
    key when counting unique NetGroups across a population of nodes.
    """
    if isinstance(ip, str):
        ip = ipaddress.ip_address(ip)
    if isinstance(ip, ipaddress.IPv4Address):
        return ipaddress.IPv4Network((int(ip), IPV4_BUCKET_BITS), strict=False)
    if ip in HENET_NETWORK:
        return ipaddress.IPv6Network((int(ip), HENET_BUCKET_BITS), strict=False)
    return ipaddress.IPv6Network((int(ip), IPV6_BUCKET_BITS), strict=False)
