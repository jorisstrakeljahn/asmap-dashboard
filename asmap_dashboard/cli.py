"""Command-line entry point for the analysis pipeline.

``main(argv)`` is wired into both ``python -m asmap_dashboard`` and the
``asmap-dashboard`` console script. Each subcommand is a small ``_run_*``
function so the dispatch table stays readable and handlers unit-test
without argparse.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Callable, Sequence
from pathlib import Path

from asmap_dashboard.analyze import analyze_map
from asmap_dashboard.asn_names import BGP_TOOLS_URL
from asmap_dashboard.asn_names import refresh as refresh_asn_names
from asmap_dashboard.diff import diff_maps
from asmap_dashboard.metrics import (
    SCHEMA_VERSION,
    generate_dashboard_data,
    generate_maps_data,
    generate_network_data,
)
from asmap_dashboard.network.whois import (
    CachedWhoisResolver,
    JsonWhoisStore,
    TeamCymruWhoisResolver,
)


def _add_whois_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--whois-cache",
        type=Path,
        default=None,
        help=(
            "Private JSON cache for independent IP-to-ASN records. "
            "Contains raw node IPs and must never be published."
        ),
    )
    upstream = parser.add_mutually_exclusive_group()
    upstream.add_argument(
        "--whois-team-cymru",
        action="store_true",
        help="Batch-resolve the newest snapshot through Team Cymru.",
    )
    upstream.add_argument(
        "--whois-fixture",
        type=Path,
        default=None,
        help="Use a local JSON fixture as the upstream resolver.",
    )
    parser.add_argument(
        "--whois-cache-max-age-hours",
        type=float,
        default=24,
        help="Refresh cached records older than this many hours (default: 24).",
    )


def _build_parser() -> argparse.ArgumentParser:
    """Construct the top-level parser, as a free function so tests can
    introspect it without running ``main``."""
    parser = argparse.ArgumentParser(prog="asmap_dashboard")
    sub = parser.add_subparsers(dest="command", required=True)

    p_analyze = sub.add_parser("analyze", help="Profile a single .dat map.")
    p_analyze.add_argument("map", type=Path)

    p_diff = sub.add_parser("diff", help="Diff two .dat maps.")
    p_diff.add_argument("map_a", type=Path)
    p_diff.add_argument("map_b", type=Path)
    p_diff.add_argument(
        "--addrs",
        type=Path,
        default=None,
        help="One IP per line; enables the bitcoin_node_impact section.",
    )

    p_metrics = sub.add_parser(
        "metrics", help="Render the full dashboard payload as JSON."
    )
    p_metrics.add_argument(
        "--data-dir",
        type=Path,
        required=True,
        help="Path to a checkout of bitcoin-core/asmap-data.",
    )
    p_metrics.add_argument(
        "--out",
        type=Path,
        default=None,
        help=(
            "Write the maps payload to this path (diffs and network go "
            "to sibling files, see --diffs-out / --network-out). "
            "Without --out the combined payload goes to stdout."
        ),
    )
    p_metrics.add_argument(
        "--diffs-out",
        type=Path,
        default=None,
        help=(
            "Where to write the all-pairs diffs payload. Defaults to "
            "diffs.json next to --out. The diffs dominate the payload "
            "size (~10 MB vs ~20 KB for the maps), so they ship as a "
            "separate file the frontend loads in parallel and renders "
            "late, keeping the first paint off the critical 10 MB path."
        ),
    )
    p_metrics.add_argument(
        "--network-out",
        type=Path,
        default=None,
        help=(
            "Where to write the network section, when snapshot sources "
            "are given. Defaults to network.json next to --out."
        ),
    )
    p_metrics.add_argument(
        "--bitnodes-dir",
        type=Path,
        default=None,
        help=(
            "Directory of Bitnodes snapshots (archived JSON crawls and/or "
            "bitnod.es CSV exports); adds the network section."
        ),
    )
    _add_whois_args(p_metrics)

    p_network = sub.add_parser(
        "network",
        help="Render network.json without computing prefix diffs.",
    )
    p_network.add_argument(
        "--data-dir",
        type=Path,
        required=True,
        help="Path to a checkout of bitcoin-core/asmap-data.",
    )
    p_network.add_argument(
        "--bitnodes-dir",
        type=Path,
        required=True,
        help="Directory containing archived and daily Bitnodes snapshots.",
    )
    p_network.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Write network.json here; without --out it goes to stdout.",
    )
    _add_whois_args(p_network)

    p_refresh = sub.add_parser(
        "refresh-asn-names",
        help="Rebuild the frontend ASN \u2192 operator-name JSON from bgp.tools.",
    )
    p_refresh.add_argument(
        "--payload",
        type=Path,
        nargs="+",
        required=True,
        help=(
            "One or more payload files (metrics.json, diffs.json, "
            "network.json) the labels should be scoped to. Missing "
            "files are skipped with a warning so the same invocation "
            "works whether or not the optional network payload exists."
        ),
    )
    p_refresh.add_argument(
        "--out",
        type=Path,
        required=True,
        help="Where to write the subset asn-names.json (frontend asset).",
    )
    p_refresh.add_argument(
        "--source-url",
        default=BGP_TOOLS_URL,
        help="Override the bgp.tools CSV URL (mainly for tests).",
    )

    return parser


def _emit_json(result: object, out_path: Path | None, *, compact: bool = False) -> int:
    """Serialise ``result`` to ``out_path`` or stdout, return exit code 0.

    ``sort_keys=True`` + trailing newline keep output byte-stable so reruns
    only diff on real changes. ``compact`` drops indentation for the
    browser-fetched metrics payload (~25 % smaller on the wire); analyze /
    diff keep the indented form for terminal reading.
    """
    if compact:
        payload = json.dumps(result, separators=(",", ":"), sort_keys=True) + "\n"
    else:
        payload = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if out_path is not None:
        out_path = Path(out_path)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(payload)
    else:
        sys.stdout.write(payload)
    return 0


def _run_analyze(args: argparse.Namespace) -> int:
    return _emit_json(analyze_map(args.map), getattr(args, "out", None))


def _run_diff(args: argparse.Namespace) -> int:
    result = diff_maps(args.map_a, args.map_b, addrs_file=args.addrs)
    return _emit_json(result, getattr(args, "out", None))


def _run_metrics(args: argparse.Namespace) -> int:
    """Generate and emit the dashboard payloads.

    With ``--out`` the payload splits into three files: maps + diff
    summary (``--out``, drives first paint), the heavy per-pair
    ``top_movers`` rosters (``--diffs-out``, ~99 % of the bytes, lazy
    -loaded by the Diff Explorer), and the network section
    (``--network-out``, when snapshot inputs are supplied). Without ``--out``
    everything goes to stdout as one document. Every document carries
    ``schema_version``.
    """
    # Only sources actually given a directory are passed through, so
    # ``metrics --data-dir X`` alone emits the snapshot-free payload.
    snapshot_sources = {
        source: directory
        for source, directory in (("bitnodes", args.bitnodes_dir),)
        if directory is not None
    }
    try:
        whois_resolver = _build_whois_resolver(args)
    except ValueError as exc:
        sys.stderr.write(f"metrics: {exc}\n")
        return 2
    result = (
        generate_dashboard_data(
            args.data_dir,
            snapshot_sources=snapshot_sources,
            whois_resolver=whois_resolver,
        )
        if snapshot_sources
        else generate_maps_data(args.data_dir)
    )
    result["schema_version"] = SCHEMA_VERSION

    if args.out is None:
        return _emit_json(result, None, compact=True)

    out: Path = args.out
    diffs_out: Path = args.diffs_out or out.parent / "diffs.json"
    network_out: Path = args.network_out or out.parent / "network.json"

    network = result.pop("network", None)
    diffs = result.pop("diffs")

    # Split each diff into a light summary (rides in metrics.json for
    # first paint) and the heavy top_movers roster (diffs.json, keyed
    # "<from>|<to>", lazy-loaded by the Diff Explorer).
    summary = [
        {key: value for key, value in diff.items() if key != "top_movers"}
        for diff in diffs
    ]
    top_movers = {f"{diff['from']}|{diff['to']}": diff["top_movers"] for diff in diffs}
    result["diffs"] = summary

    _emit_json(result, out, compact=True)
    _emit_json(
        {"schema_version": SCHEMA_VERSION, "top_movers": top_movers},
        diffs_out,
        compact=True,
    )
    if network is not None:
        _emit_json(
            {"schema_version": SCHEMA_VERSION, "network": network},
            network_out,
            compact=True,
        )
    return 0


def _build_whois_resolver(
    args: argparse.Namespace,
) -> CachedWhoisResolver | None:
    fixture = getattr(args, "whois_fixture", None)
    use_team_cymru = getattr(args, "whois_team_cymru", False)
    cache_path = getattr(args, "whois_cache", None)
    if (fixture is not None or use_team_cymru) and cache_path is None:
        raise ValueError("WHOIS upstream requires --whois-cache")
    if cache_path is None:
        return None
    max_age_hours = getattr(args, "whois_cache_max_age_hours", 24)
    if max_age_hours <= 0:
        raise ValueError("--whois-cache-max-age-hours must be positive")
    upstream = (
        JsonWhoisStore(fixture)
        if fixture is not None
        else TeamCymruWhoisResolver()
        if use_team_cymru
        else None
    )
    return CachedWhoisResolver(
        JsonWhoisStore(cache_path),
        upstream=upstream,
        # A cache-only run cannot refresh stale records. Preserve its explicit
        # offline behavior; production always supplies Team Cymru and a TTL.
        max_age_seconds=round(max_age_hours * 3600) if upstream else None,
    )


def _run_network(args: argparse.Namespace) -> int:
    """Generate network.json without the expensive prefix-diff pass."""
    try:
        whois_resolver = _build_whois_resolver(args)
    except ValueError as exc:
        sys.stderr.write(f"network: {exc}\n")
        return 2
    network = generate_network_data(
        args.data_dir,
        snapshot_sources={"bitnodes": args.bitnodes_dir},
        whois_resolver=whois_resolver,
    )
    return _emit_json(
        {"schema_version": SCHEMA_VERSION, "network": network},
        args.out,
        compact=True,
    )


def _run_refresh_asn_names(args: argparse.Namespace) -> int:
    count = refresh_asn_names(args.payload, args.out, source_url=args.source_url)
    sys.stderr.write(f"Wrote {count} ASN names to {args.out}\n")
    return 0


# Subcommand -> handler. argparse rejects unknown commands at parse time,
# so a KeyError here would be a wiring bug, not bad user input.
_COMMANDS: dict[str, Callable[[argparse.Namespace], int]] = {
    "analyze": _run_analyze,
    "diff": _run_diff,
    "metrics": _run_metrics,
    "network": _run_network,
    "refresh-asn-names": _run_refresh_asn_names,
}


def main(argv: Sequence[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    return _COMMANDS[args.command](args)


if __name__ == "__main__":
    sys.exit(main())
