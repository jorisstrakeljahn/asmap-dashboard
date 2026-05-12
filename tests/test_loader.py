"""Tests for asmap_dashboard.loader."""

from __future__ import annotations

import dataclasses
import ipaddress

import pytest

from asmap_dashboard._vendor.asmap import ASMap
from asmap_dashboard.loader import LoadedMap, load_map

from .conftest import write_asmap


def test_load_map_returns_parsed_asmap_with_file_size(tmp_path):
    """A valid .dat file loads into a LoadedMap with the on-disk size."""
    path = write_asmap(
        tmp_path / "ok.dat",
        [(ipaddress.IPv4Network("1.0.0.0/8"), 100)],
    )

    loaded = load_map(path)

    assert isinstance(loaded, LoadedMap)
    assert isinstance(loaded.asmap, ASMap)
    assert loaded.file_size_bytes == path.stat().st_size


def test_load_map_caches_entries_count(tmp_path):
    """LoadedMap precomputes entries_count so diff loops avoid extra trie walks."""
    path = write_asmap(
        tmp_path / "three.dat",
        [
            (ipaddress.IPv4Network("1.0.0.0/8"), 100),
            (ipaddress.IPv4Network("2.0.0.0/8"), 200),
            (ipaddress.IPv6Network("2001::/16"), 300),
        ],
    )

    loaded = load_map(path)

    assert loaded.entries_count == len(loaded.asmap.to_entries())
    assert loaded.entries_count == 3


def test_load_map_raises_on_invalid_binary(tmp_path):
    path = tmp_path / "garbage.dat"
    path.write_bytes(b"\xff" * 32)

    with pytest.raises(ValueError):
        load_map(path)


def test_loaded_map_is_immutable(tmp_path):
    """LoadedMap is frozen so callers cannot mutate the cached state."""
    path = write_asmap(
        tmp_path / "ok.dat",
        [(ipaddress.IPv4Network("1.0.0.0/8"), 100)],
    )

    loaded = load_map(path)

    with pytest.raises(dataclasses.FrozenInstanceError):
        loaded.file_size_bytes = 0  # type: ignore[misc]
