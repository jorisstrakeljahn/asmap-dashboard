"""Tests for asmap_dashboard.netgroup."""

from __future__ import annotations

import ipaddress

from asmap_dashboard.netgroup import default_netgroup


def test_ipv4_addresses_bucket_by_slash_sixteen():
    """IPv4 addresses inside the same /16 share a bucket; different /16s do not."""
    a = default_netgroup("192.168.1.5")
    b = default_netgroup("192.168.255.250")
    c = default_netgroup("192.169.1.5")

    assert a == ipaddress.IPv4Network("192.168.0.0/16")
    assert a == b
    assert a != c


def test_ipv6_addresses_bucket_by_slash_thirtytwo():
    """IPv6 addresses inside the same /32 share a bucket; different /32s do not."""
    a = default_netgroup("2001:db8:1111:2222::1")
    b = default_netgroup("2001:db8:9999:8888::1")
    c = default_netgroup("2001:db9::1")

    assert a == ipaddress.IPv6Network("2001:db8::/32")
    assert a == b
    assert a != c


def test_henet_addresses_bucket_by_slash_thirtysix():
    """Hurricane Electric tunnel addresses bucket by /36 instead of /32."""
    # /36 covers the first 4 bits of the third 16-bit group, so addresses
    # whose third group starts with the same hex nibble share a bucket.
    same_a = default_netgroup("2001:470:1::1")  # group3 0001, nibble 0
    same_b = default_netgroup("2001:470:fff::1")  # group3 0fff, nibble 0
    other = default_netgroup("2001:470:1000::1")  # group3 1000, nibble 1

    assert same_a == ipaddress.IPv6Network("2001:470::/36")
    assert same_a == same_b
    assert same_a != other
    assert other == ipaddress.IPv6Network("2001:470:1000::/36")


def test_ipv4_embedding_ipv6_buckets_as_the_linked_ipv4():
    """Tunneled / translated IPv6 buckets with its embedded IPv4's /16.

    Mirrors CNetAddr::GetLinkedIPv4(): every range that merely
    transports an IPv4 host (here 1.2.3.4) must land in the same
    bucket as the native address. Byte layouts per the RFCs:

      v4-mapped (RFC 4291):  ::ffff:1.2.3.4
      NAT64     (RFC 6052):  64:ff9b::1.2.3.4
      SIIT      (RFC 6145):  ::ffff:0:1.2.3.4 (IPv4 in the last 4 bytes)
      6to4      (RFC 3964):  2002:0102:0304:: (IPv4 in bytes 2-6)
      Teredo    (RFC 4380):  last 4 bytes are the IPv4 bit-inverted,
                             ~0x01020304 = 0xfefdfcfb
    """
    native = default_netgroup("1.2.3.4")

    assert native == ipaddress.IPv4Network("1.2.0.0/16")
    assert default_netgroup("::ffff:1.2.3.4") == native
    assert default_netgroup("64:ff9b::1.2.3.4") == native
    assert default_netgroup("::ffff:0:102:304") == native
    assert default_netgroup("2002:102:304::1") == native
    assert default_netgroup("2001:0:4137:9e76:8000:63bf:fefd:fcfb") == native


def test_ipv4_embedding_ranges_are_not_confused_with_lookalikes():
    """Neighbouring native-IPv6 ranges stay in their own /32 buckets.

    2001:db8::/32 sits right next to Teredo's 2001::/32 and HE.net's
    2001:470::/32; none of the three may bleed into another. This
    pins the range checks to exact prefixes rather than "starts
    with 2001".
    """
    teredo = default_netgroup("2001::fefd:fcfb")
    henet = default_netgroup("2001:470::1")
    docs = default_netgroup("2001:db8::1")

    assert teredo == ipaddress.IPv4Network("1.2.0.0/16")
    assert henet == ipaddress.IPv6Network("2001:470::/36")
    assert docs == ipaddress.IPv6Network("2001:db8::/32")


def test_returned_buckets_are_usable_as_dict_keys():
    """Bucket values are hashable so the same address always lands on the same dict key."""
    counts: dict = {}
    for addr in ["1.2.3.4", "1.2.99.99", "5.6.7.8", "2001:db8::1"]:
        counts[default_netgroup(addr)] = counts.get(default_netgroup(addr), 0) + 1

    assert counts[default_netgroup("1.2.3.4")] == 2
    assert counts[default_netgroup("5.6.7.8")] == 1
    assert counts[default_netgroup("2001:db8::1")] == 1
