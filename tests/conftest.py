"""Shared pytest fixtures and helpers."""

from __future__ import annotations

import ipaddress
from pathlib import Path
from typing import Iterable, Tuple, Union

from asmap_dashboard._vendor.asmap import ASMap, net_to_prefix

Network = Union[ipaddress.IPv4Network, ipaddress.IPv6Network]
Entry = Tuple[Network, int]


def write_asmap(path: Path, entries: Iterable[Entry]) -> Path:
    """Write a tiny ASmap binary file from a list of (network, asn) pairs.

    Used by tests to assemble fixtures small enough to reason about by
    hand, while exercising exactly the same encoder the published .dat
    files are produced with.
    """
    bin_entries = [(net_to_prefix(net), asn) for net, asn in entries]
    path.write_bytes(ASMap(bin_entries).to_binary())
    return path
