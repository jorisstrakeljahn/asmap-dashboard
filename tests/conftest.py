"""Shared pytest fixtures and helpers."""

from __future__ import annotations

import io
import ipaddress
from collections.abc import Iterable
from pathlib import Path

from asmap_dashboard._vendor.asmap import ASMap, net_to_prefix

Network = ipaddress.IPv4Network | ipaddress.IPv6Network
Entry = tuple[Network, int]


def write_asmap(path: Path, entries: Iterable[Entry]) -> Path:
    """Write a tiny ASmap binary file from a list of (network, asn) pairs.

    Used by tests to assemble fixtures small enough to reason about by
    hand, while exercising exactly the same encoder the published .dat
    files are produced with.
    """
    bin_entries = [(net_to_prefix(net), asn) for net, asn in entries]
    path.write_bytes(ASMap(bin_entries).to_binary())
    return path


def fake_urlopen_response(body: bytes):
    """Minimal ``urllib.request.urlopen`` stand-in for the bgp.tools fetch.

    A ``BytesIO`` that doubles as its own context manager, so tests can
    patch ``urlopen`` without a real network call.
    """

    class _Response(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *_exc):
            self.close()
            return False

    return _Response(body)
