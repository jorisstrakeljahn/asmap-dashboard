"""Aggregate per-build profiles and every-pair diffs into a single payload.

The result is the data contract the frontend consumes for the Maps tab.
Discovery is deliberately tied to the asmap-data layout (year folders
holding files named ``<unix_timestamp>_asmap.dat`` and / or
``<unix_timestamp>_asmap_unfilled.dat``) rather than a generic glob, so
the released-at date can be derived from the filename without parsing
git history.

A "build" is the (year-folder, timestamp) pair. Each build can publish
two binary variants:

  - unfilled: only the prefixes that came out of the upstream data
    pipeline (RPKI / IRR / Routeviews). This is the canonical source
    of truth - filled can be derived deterministically from it,
    the reverse is not possible.
  - filled:   the same data with ``asmap-tool encode --fill`` applied
    so adjacent same-AS prefixes collapse into a smaller binary. This
    is the form Bitcoin Core embeds.

Most published builds carry both. A few historical builds carry only
one; the dashboard surfaces that asymmetry as a ``present: false`` flag
on the missing side, instead of silently dropping the other variant.

Each .dat file is read and parsed exactly once. Both the analyze and
the all-pairs diff phases reuse the same parsed map, which avoids
the O(N^2) re-parse that would otherwise dominate runtime as the
upstream history grows.
"""

from __future__ import annotations

import itertools
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Union

from asmap_dashboard.analyze import analyze_loaded_map
from asmap_dashboard.diff import diff_loaded_maps
from asmap_dashboard.loader import LoadedMap, load_map

PathLike = Union[str, Path]
FILLED_FILENAME_RE = re.compile(r"^(\d+)_asmap\.dat$")
UNFILLED_FILENAME_RE = re.compile(r"^(\d+)_asmap_unfilled\.dat$")
YEAR_DIRNAME_RE = re.compile(r"^\d{4}$")


@dataclass(frozen=True)
class DiscoveredBuild:
    """One published asmap-data build, indexed by its release timestamp.

    ``name`` is the variant-agnostic identifier shared by both binary
    files (``"2025/1755187200"``). The two variant paths are absolute
    references into the data directory; either one (but never both) can
    be ``None`` for builds where the corresponding file was not
    published.
    """

    timestamp: int
    name: str
    unfilled_path: Optional[Path]
    filled_path: Optional[Path]


def discover_maps(data_dir: PathLike) -> List[DiscoveredBuild]:
    """Return one DiscoveredBuild per (year, timestamp), sorted in time.

    Both variants of a build are merged into a single entry so the
    pipeline reasons about "the 2025-08-14 build" rather than about
    two disjoint files. Builds that carry only one variant still
    appear, with the missing side set to ``None``; downstream code
    decides per-metric whether that constitutes a hole in the chart
    or a graceful fallback.

    Only four-digit year subdirectories are walked so unrelated entries
    in the asmap-data checkout (``.git``, ``README.md``, future
    ``docs/`` folder, ``latest_asmap.dat`` convenience copy at the root,
    etc.) cannot accidentally feed the parser.
    """
    data_dir = Path(data_dir)
    builds: Dict[tuple, dict] = {}
    year_dirs = sorted(
        p for p in data_dir.iterdir() if p.is_dir() and YEAR_DIRNAME_RE.match(p.name)
    )
    for year_dir in year_dirs:
        for entry in sorted(year_dir.iterdir()):
            ts, kind = _classify(entry.name)
            if ts is None:
                continue
            key = (year_dir.name, ts)
            slot = builds.setdefault(
                key, {"unfilled": None, "filled": None}
            )
            slot[kind] = entry

    out: List[DiscoveredBuild] = []
    for (year, ts), slot in builds.items():
        unfilled = slot["unfilled"]
        filled = slot["filled"]
        # ``name`` is the variant-agnostic id. We pick whichever side
        # exists to derive it. Both variants live in the same year
        # folder under the same numeric stem, so the identifier is
        # well-defined regardless of which file we inspect.
        sample = unfilled or filled
        assert sample is not None  # reached only if ``builds`` had a key
        name = f"{year}/{sample.stem.split('_', 1)[0]}"
        out.append(
            DiscoveredBuild(
                timestamp=ts,
                name=name,
                unfilled_path=unfilled,
                filled_path=filled,
            )
        )
    out.sort(key=lambda b: b.timestamp)
    return out


def _classify(filename: str) -> tuple:
    """Return (timestamp, "unfilled" | "filled") or (None, None).

    The unfilled match is checked first because both regexes share the
    ``\\d+_asmap`` prefix; matching unfilled before filled avoids the
    edge case where ``\\d+_asmap`` would also partially match the
    unfilled filename.
    """
    m = UNFILLED_FILENAME_RE.match(filename)
    if m:
        return int(m.group(1)), "unfilled"
    m = FILLED_FILENAME_RE.match(filename)
    if m:
        return int(m.group(1)), "filled"
    return None, None


def _to_iso_date(unix_ts: int) -> str:
    return datetime.fromtimestamp(unix_ts, tz=timezone.utc).date().isoformat()


def generate_dashboard_data(data_dir: PathLike) -> dict:
    """Walk data_dir, profile every published variant, diff every pair.

    Returns a dict shaped like::

        {
          "maps":  [
            {
              "name": "2025/1755187200",
              "released_at": "2025-08-14",
              "unfilled": {"present": true, "path": "...", ...profile...},
              "filled":   {"present": true, "path": "...", ...profile...}
            },
            ...
          ],
          "diffs": [{from, to, total_changes, ...}, ...]
        }

    Builds are sorted chronologically by released_at. ``name`` is the
    variant-agnostic identifier (``<year>/<timestamp>``) so the
    frontend reasons about builds, not about individual files. Each
    map entry carries both variants under explicit ``unfilled`` /
    ``filled`` sub-objects; the missing side becomes ``{"present":
    false}`` on builds that only published one. This keeps the schema
    rectangular (no missing keys to defend against in the frontend).

    Diffs are computed from the unfilled variant of both sides
    whenever available (see ``_compute_pair_diffs`` for why). Each
    diff entry carries an explicit ``variant`` field so the frontend
    can label the comparison and so a future switch in the picking
    rule stays auditable.

    The payload is intentionally free of machine-local context (input
    directory, generation timestamp): it must stay byte-stable across
    runs whenever the underlying .dat files are unchanged, so the daily
    CI refresh only commits when the dashboard data actually shifted.
    """
    data_dir = Path(data_dir)
    builds = discover_maps(data_dir)

    # Parse every published .dat file exactly once and remember the
    # parsed result keyed by absolute path. Both the per-variant
    # profiling pass and the diff pass below pick from this cache, so
    # no .dat is touched twice across the run.
    loaded: Dict[Path, LoadedMap] = {}
    for build in builds:
        for path in (build.unfilled_path, build.filled_path):
            if path is not None and path not in loaded:
                loaded[path] = load_map(path)

    maps = [_build_entry(build, loaded, data_dir) for build in builds]
    diffs = _compute_pair_diffs(builds, loaded)

    return {
        "maps": maps,
        "diffs": diffs,
    }


def _compute_pair_diffs(
    builds: List[DiscoveredBuild],
    loaded: Dict[Path, LoadedMap],
) -> List[dict]:
    """Diff every chronological pair of builds, preferring unfilled.

    Why unfilled: filled-vs-filled diffs conflate two unrelated
    sources of change. Real BGP shifts in the underlying RPKI / IRR /
    Routeviews data show up as prefix reassignments, but so does any
    rebalancing the ``--fill`` heuristic does when adjacent same-AS
    prefixes appear or disappear. Unfilled-vs-unfilled isolates the
    first signal, which is the one a Maps-tab reviewer actually
    wants to see.

    Pair selection is asymmetric on purpose. A pair is only diffed
    when both sides published an unfilled variant; mixed
    unfilled-vs-filled is silently skipped because the two encodings
    answer different questions and a number derived from them would
    be misleading. The single filled-only build in the historical
    inventory (2025-03-21) therefore drops out of the diff timeline
    until / unless an unfilled is back-published for it. The frontend
    surfaces this as a gap in the drift chart, not as a wrong number.
    """
    diffable: List[tuple] = [
        (build, loaded[build.unfilled_path])
        for build in builds
        if build.unfilled_path is not None
    ]
    out: List[dict] = []
    for (build_a, loaded_a), (build_b, loaded_b) in itertools.combinations(
        diffable, 2
    ):
        diff = diff_loaded_maps(loaded_a, loaded_b)
        diff["from"] = build_a.name
        diff["to"] = build_b.name
        diff["variant"] = "unfilled"
        out.append(diff)
    return out


def _build_entry(
    build: DiscoveredBuild,
    loaded: Dict[Path, LoadedMap],
    data_dir: Path,
) -> dict:
    """Assemble the maps[] entry for one build with both variants."""
    return {
        "name": build.name,
        "released_at": _to_iso_date(build.timestamp),
        "unfilled": _variant_payload(build.unfilled_path, loaded, data_dir),
        "filled": _variant_payload(build.filled_path, loaded, data_dir),
    }


def _variant_payload(
    path: Optional[Path],
    loaded: Dict[Path, LoadedMap],
    data_dir: Path,
) -> dict:
    """Return the per-variant profile dict, or {"present": false}.

    Both branches return a dict with the same outer shape (an
    ``"present"`` flag plus optional profile fields), so the frontend
    can always read ``map.unfilled.present`` without checking for
    missing keys.
    """
    if path is None:
        return {"present": False}
    profile = analyze_loaded_map(loaded[path])
    return {
        "present": True,
        "path": path.relative_to(data_dir).as_posix(),
        **profile,
    }
