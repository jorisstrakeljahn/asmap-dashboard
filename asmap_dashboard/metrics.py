"""Aggregate per-build profiles and every-pair diffs into a single payload.

The result is the data contract the frontend consumes for the Maps tab.
Discovery is deliberately tied to the asmap-data layout (year folders
holding files named ``<unix_timestamp>_asmap.dat``) rather than a generic
glob, so the released-at date can be derived from the filename without
parsing git history.
"""

from __future__ import annotations

import itertools
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Tuple, Union

from asmap_dashboard.analyze import analyze_map
from asmap_dashboard.diff import diff_maps

PathLike = Union[str, Path]
TIMESTAMP_FILENAME_RE = re.compile(r"^(\d+)_asmap\.dat$")


def generate_dashboard_data(data_dir: PathLike) -> dict:
    """Walk data_dir, profile every published map, diff every adjacent pair.

    Returns a dict shaped like::

        {
          "generated_at": "2026-05-07T20:08:00+00:00",
          "source": {"data_dir": "..."},
          "maps":  [{name, released_at, entries_count, ...}, ...],
          "diffs": [{from, to, total_changes, ...}, ...],
        }

    Maps are sorted chronologically by released_at. Diffs cover every
    unordered pair (C(N, 2) entries), with ``from`` always older than
    ``to``, so the frontend can offer arbitrary Map A vs Map B selection
    without any client-side computation.
    """
    discovered = discover_maps(data_dir)
    data_dir = Path(data_dir)

    maps = []
    for released_ts, path in discovered:
        profile = analyze_map(path)
        profile["name"] = path.relative_to(data_dir).as_posix()
        profile["released_at"] = _to_iso_date(released_ts)
        maps.append(profile)

    diffs = []
    for (_ts_a, path_a), (_ts_b, path_b) in itertools.combinations(discovered, 2):
        diff = diff_maps(path_a, path_b)
        diff["from"] = path_a.relative_to(data_dir).as_posix()
        diff["to"] = path_b.relative_to(data_dir).as_posix()
        diffs.append(diff)

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": {"data_dir": str(data_dir)},
        "maps": maps,
        "diffs": diffs,
    }


def discover_maps(data_dir: PathLike) -> List[Tuple[int, Path]]:
    """Return (unix_timestamp, path) tuples for filled .dat files, sorted."""
    data_dir = Path(data_dir)
    found: List[Tuple[int, Path]] = []
    for year_dir in sorted(p for p in data_dir.iterdir() if p.is_dir()):
        for entry in sorted(year_dir.iterdir()):
            match = TIMESTAMP_FILENAME_RE.match(entry.name)
            if match:
                found.append((int(match.group(1)), entry))
    found.sort(key=lambda pair: pair[0])
    return found


def _to_iso_date(unix_ts: int) -> str:
    return datetime.fromtimestamp(unix_ts, tz=timezone.utc).date().isoformat()
