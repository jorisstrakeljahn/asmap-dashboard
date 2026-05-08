"""Shared loader for ASmap binary files.

Both the per-map profile (analyze) and the two-map diff need a
parsed ASMap and the on-disk size of the source file. Loading is
isolated here so the metrics pipeline can parse each .dat file
exactly once and feed the parsed result into every downstream
caller, instead of re-parsing the same file 2*(N-1) times across
the all-pairs diff loop.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Union

from asmap_dashboard._vendor.asmap import ASMap

PathLike = Union[str, Path]


@dataclass(frozen=True)
class LoadedMap:
    """An ASmap binary file parsed once, ready for analyze or diff.

    ``entries_count`` is precomputed at load time. Both downstream
    consumers need it (analyze for the profile output, diff for the
    entries_a / entries_b reporting), and to_entries() is itself a
    full trie walk; caching the length here avoids paying that cost
    twice per all-pairs diff.
    """

    asmap: ASMap
    file_size_bytes: int
    entries_count: int


def load_map(path: PathLike) -> LoadedMap:
    """Read a .dat file and return its parsed ASMap with on-disk size.

    Raises:
        ValueError: if the file does not parse as a valid ASmap binary.
    """
    path = Path(path)
    bindata = path.read_bytes()
    asmap = ASMap.from_binary(bindata)
    if asmap is None:
        raise ValueError(f"{path} is not a valid ASmap binary file")
    return LoadedMap(
        asmap=asmap,
        file_size_bytes=len(bindata),
        entries_count=len(asmap.to_entries()),
    )
