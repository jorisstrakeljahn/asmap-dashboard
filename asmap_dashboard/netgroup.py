"""Default Bitcoin Core NetGroup buckets for IPv4 and IPv6 addresses.

This is the baseline that Bitcoin Core's GetGroup() falls back on
when no ASmap is loaded. The dashboard compares it against the
ASmap-derived NetGroup count to quantify the diversity gain ASmap
provides over plain prefix bucketing.

Rules, mirrored from ``NetGroupManager::GetGroup()`` in Bitcoin
Core's src/netgroup.cpp together with ``CNetAddr::GetLinkedIPv4()``
in src/netaddress.cpp:

  - IPv4 addresses bucket by /16.
  - IPv6 addresses that merely transport an IPv4 host (v4-mapped
    RFC 4291, NAT64 RFC 6052, SIIT RFC 6145, 6to4 RFC 3964, Teredo
    RFC 4380) are unwrapped first and bucket as that IPv4's /16, so
    a tunneled peer and its native-IPv4 twin share a bucket.
  - IPv6 addresses inside Hurricane Electric's 2001:470::/32 tunnel
    range bucket by /36, so the dozen-or-so /36 sub-allocations
    inside HE.net do not collapse into a single /32 group.
  - All other IPv6 addresses bucket by /32.

Deliberately not mirrored: Core's catch-all groups for local,
internal, and unroutable addresses, and the non-IP networks (Tor,
I2P, CJDNS). Crawler snapshots only ever carry routable clearnet
IPs, so those branches would be dead code here.
"""

from __future__ import annotations

import ipaddress

IPV4_BUCKET_BITS = 16
IPV6_BUCKET_BITS = 32
HENET_BUCKET_BITS = 36

HENET_NETWORK = ipaddress.IPv6Network("2001:470::/32")

# IPv6 ranges that embed an IPv4 address, in CNetAddr terms:
# IsRFC6052 / IsRFC6145 / IsRFC3964 / IsRFC4380. The v4-mapped
# range (::ffff:0:0/96, RFC 4291) needs no constant of its own —
# Python's ipaddress exposes it via IPv6Address.ipv4_mapped.
RFC6052_NETWORK = ipaddress.IPv6Network("64:ff9b::/96")
RFC6145_NETWORK = ipaddress.IPv6Network("::ffff:0:0:0/96")
SIX_TO_FOUR_NETWORK = ipaddress.IPv6Network("2002::/16")
TEREDO_NETWORK = ipaddress.IPv6Network("2001::/32")

IPAddress = ipaddress.IPv4Address | ipaddress.IPv6Address
NetGroup = ipaddress.IPv4Network | ipaddress.IPv6Network


def default_netgroup(ip: str | IPAddress) -> NetGroup:
    """Return the network bucket Bitcoin Core's GetGroup() would assign.

    The result is hashable, so it can be used directly as a dict or set
    key when counting unique NetGroups across a population of nodes.
    """
    if isinstance(ip, str):
        ip = ipaddress.ip_address(ip)
    if isinstance(ip, ipaddress.IPv6Address):
        linked = linked_ipv4(ip)
        if linked is not None:
            ip = linked
    if isinstance(ip, ipaddress.IPv4Address):
        return ipaddress.IPv4Network((int(ip), IPV4_BUCKET_BITS), strict=False)
    if ip in HENET_NETWORK:
        return ipaddress.IPv6Network((int(ip), HENET_BUCKET_BITS), strict=False)
    return ipaddress.IPv6Network((int(ip), IPV6_BUCKET_BITS), strict=False)


def linked_ipv4(ip: ipaddress.IPv6Address) -> ipaddress.IPv4Address | None:
    """The IPv4 address embedded in ``ip``, or None for native IPv6.

    Mirrors ``CNetAddr::GetLinkedIPv4()``: each branch reads the
    IPv4 host out of the byte positions the respective RFC assigns.
    The ranges are mutually disjoint, so the check order does not
    matter for correctness; it follows Core's for easy side-by-side
    review.

    Public because the network metrics need the same unwrap for
    their asmap lookups — Core's ``GetMappedAS()`` resolves a
    linked-IPv4 peer through the map as that IPv4, not as the
    IPv6 wrapper.
    """
    if ip.ipv4_mapped is not None:
        return ip.ipv4_mapped
    value = int(ip)
    if ip in RFC6052_NETWORK or ip in RFC6145_NETWORK:
        # NAT64 / SIIT translation: IPv4 in the last 4 bytes.
        return ipaddress.IPv4Address(value & 0xFFFF_FFFF)
    if ip in SIX_TO_FOUR_NETWORK:
        # 6to4 tunnel: IPv4 in bytes 2-6.
        return ipaddress.IPv4Address((value >> 80) & 0xFFFF_FFFF)
    if ip in TEREDO_NETWORK:
        # Teredo tunnel: the client's IPv4 sits in the last 4
        # bytes, bit-inverted (RFC 4380 section 4).
        return ipaddress.IPv4Address(~value & 0xFFFF_FFFF)
    return None
