"""Aggregate per-build profiles and every-pair diffs into the Maps-tab payload.

A "build" is a (year-folder, timestamp) pair; discovery is tied to the
asmap-data layout (``<year>/<timestamp>_asmap[_unfilled].dat``) so the
release date comes from the filename, not git history. Each build can
publish two variants: ``unfilled`` (the canonical upstream pipeline
output) and ``filled`` (the same data with adjacent same-AS prefixes
merged — the form Bitcoin Core embeds). A build with only one variant
surfaces the other as ``present: false``.

Each .dat is parsed once and reused by both the analyze and all-pairs
diff phases, avoiding an O(N^2) re-parse.
"""

from __future__ import annotations

import itertools
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from asmap_dashboard.analyze import analyze_loaded_map
from asmap_dashboard.diff import diff_loaded_maps
from asmap_dashboard.loader import LoadedMap, PathLike, load_map
from asmap_dashboard.network.metrics import build_network_section
from asmap_dashboard.network.snapshots import discover_snapshots

# JSON data-contract version (app.js mirrors it as
# EXPECTED_SCHEMA_VERSION). Bump on any field-name or semantics change;
# the frontend refuses a payload whose version it does not expect rather
# than silently computing nonsense against a renamed field.
SCHEMA_VERSION = 8

FILLED_FILENAME_RE = re.compile(r"^(\d+)_asmap\.dat$")
UNFILLED_FILENAME_RE = re.compile(r"^(\d+)_asmap_unfilled\.dat$")
YEAR_DIRNAME_RE = re.compile(r"^\d{4}$")


@dataclass(frozen=True)
class DiscoveredBuild:
    """One published asmap-data build, indexed by its release timestamp.

    ``name`` is the variant-agnostic id shared by both files
    (``"2025/1755187200"``). Either variant path (never both) is ``None``
    when that file was not published.
    """

    timestamp: int
    name: str
    unfilled_path: Path | None
    filled_path: Path | None


def discover_maps(data_dir: PathLike) -> list[DiscoveredBuild]:
    """Return one DiscoveredBuild per (year, timestamp), sorted in time.

    Both variants merge into one entry so the pipeline reasons about "the
    2025-08-14 build", not two files; a one-variant build keeps the
    missing side ``None``. Only four-digit year subdirectories are walked,
    so other entries in the checkout (``.git``, ``latest_asmap.dat``, ...)
    cannot feed the parser.
    """
    data_dir = Path(data_dir)
    builds: dict[tuple[str, int], dict[str, Path | None]] = {}
    year_dirs = sorted(
        p for p in data_dir.iterdir() if p.is_dir() and YEAR_DIRNAME_RE.match(p.name)
    )
    for year_dir in year_dirs:
        for entry in sorted(year_dir.iterdir()):
            ts, kind = _classify(entry.name)
            if ts is None:
                continue
            key = (year_dir.name, ts)
            slot = builds.setdefault(key, {"unfilled": None, "filled": None})
            slot[kind] = entry

    out: list[DiscoveredBuild] = []
    for (year, ts), slot in builds.items():
        unfilled = slot["unfilled"]
        filled = slot["filled"]
        # Either variant gives the same id (same year folder, same stem).
        sample = unfilled or filled
        assert sample is not None  # a key exists only if a file filled it
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


def _classify(filename: str) -> tuple[int | None, str | None]:
    """Return (timestamp, "unfilled" | "filled") or (None, None).

    Unfilled is matched first: both regexes are anchored, but checking the
    longer ``_asmap_unfilled`` suffix first keeps the intent obvious.
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


def generate_dashboard_data(
    data_dir: PathLike,
    snapshot_sources: dict[str, PathLike] | None = None,
) -> dict:
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

    When ``snapshot_sources`` (a ``{source_name: directory}`` map) is
    given, a ``network`` key carries the network-tap metrics for those
    snapshots; it is omitted when no sources are passed or none yield
    usable snapshots, so the Maps/Diff payload stays byte-identical for
    callers that do not opt in.

    Each map entry carries both variants under ``unfilled`` / ``filled``,
    the missing side as ``{"present": false}``, keeping the schema
    rectangular. Diffs prefer the unfilled variant (see
    ``_compute_pair_diffs``) and carry an explicit ``variant`` field.

    The payload carries no machine-local context (input dir, timestamps)
    so it stays byte-stable across runs on unchanged inputs, and the daily
    CI refresh only commits real data shifts.
    """
    data_dir = Path(data_dir)
    builds = discover_maps(data_dir)

    # Parse every .dat once, keyed by path; both the profiling and diff
    # passes read from this cache.
    loaded: dict[Path, LoadedMap] = {}
    for build in builds:
        for path in (build.unfilled_path, build.filled_path):
            if path is not None and path not in loaded:
                loaded[path] = load_map(path)

    maps = [_build_entry(build, loaded, data_dir) for build in builds]
    diffs = _compute_pair_diffs(builds, loaded)

    payload: dict = {
        "maps": maps,
        "diffs": diffs,
    }

    if snapshot_sources:
        # Group by each snapshot's *own* source, not the directory key:
        # the Bitnodes dir mixes b10c JSON ("bitnodes") and bitnod.es CSV
        # ("bitmex"), and splitting them keeps the crawler handover a
        # distinct line. Re-sort since the interleaving breaks ordering.
        snapshots_by_source: dict[str, list] = {}
        for source, directory in snapshot_sources.items():
            for snapshot in discover_snapshots(directory, source):
                snapshots_by_source.setdefault(snapshot.source, []).append(snapshot)
        for snapshots in snapshots_by_source.values():
            snapshots.sort(key=lambda s: s.timestamp)
        network = build_network_section(builds, loaded, snapshots_by_source)
        if network:
            payload["network"] = network

    return payload


def _compute_pair_diffs(
    builds: list[DiscoveredBuild],
    loaded: dict[Path, LoadedMap],
) -> list[dict]:
    """Diff every chronological pair of builds, preferring unfilled.

    Why unfilled: filled-vs-filled would conflate real BGP/RPKI/IRR
    shifts with the rebalancing the ``--fill`` heuristic does, so only
    unfilled-vs-unfilled isolates the signal a reviewer wants. A pair is
    diffed only when both sides have an unfilled variant; a filled-only
    build drops out of the timeline and the frontend shows a gap, never a
    misleading number.

    Explicit O(N^2) all-pairs walk so the Diff Explorer can pivot to any
    (A, B) with no backend. Affordable today (~50 builds = 1225 diffs,
    seconds of CPU); the switch point is ~150 builds (~2027-2028), where
    the drop-in is adjacent pairs + a few reference distances computed
    lazily in the browser. With snapshot sources a second, cheaper
    all-pairs pass runs (``network.metrics._build_node_impact``) under the
    same pair count and budget.
    """
    diffable: list[tuple[DiscoveredBuild, LoadedMap]] = [
        (build, loaded[build.unfilled_path])
        for build in builds
        if build.unfilled_path is not None
    ]
    # Per-ASN presence is cached on each LoadedMap at parse time, so this
    # loop reuses those caches instead of re-walking the trie per pair.
    out: list[dict] = []
    for (build_a, loaded_a), (build_b, loaded_b) in itertools.combinations(diffable, 2):
        diff = diff_loaded_maps(loaded_a, loaded_b)
        diff["from"] = build_a.name
        diff["to"] = build_b.name
        diff["variant"] = "unfilled"
        out.append(diff)
    return out


def _build_entry(
    build: DiscoveredBuild,
    loaded: dict[Path, LoadedMap],
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
    path: Path | None,
    loaded: dict[Path, LoadedMap],
    data_dir: Path,
) -> dict:
    """Return the per-variant profile dict, or {"present": false}.

    Both branches share the ``"present"`` flag so the frontend reads
    ``map.unfilled.present`` without guarding for missing keys.
    """
    if path is None:
        return {"present": False}
    profile = analyze_loaded_map(loaded[path])
    return {
        "present": True,
        "path": path.relative_to(data_dir).as_posix(),
        **profile,
    }
