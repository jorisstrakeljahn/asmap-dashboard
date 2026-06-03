"""Command-line entry point for the analysis pipeline.

The module exposes one ``main(argv)`` entry that is wired both into
``python -m asmap_dashboard`` (via ``__main__.py``) and into the
``asmap-dashboard`` console script declared in ``pyproject.toml``.
Each subcommand is implemented as a small ``_run_*`` function so the
dispatch table at the bottom stays readable and each handler can be
unit-tested without going through argparse.
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
from asmap_dashboard.metrics import generate_dashboard_data


def _build_parser() -> argparse.ArgumentParser:
    """Construct the top-level argparse parser with every subcommand.

    Kept as a free function so tests and shell-completion generators
    can introspect the parser without paying the cost of running
    ``main``.
    """
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
        help="Write JSON to this path instead of stdout.",
    )
    p_metrics.add_argument(
        "--kit-dir",
        type=Path,
        default=None,
        help="Directory of KIT dossier JSON files; adds the network section.",
    )
    p_metrics.add_argument(
        "--bitnodes-dir",
        type=Path,
        default=None,
        help="Directory of Bitnodes snapshot JSON files; adds the network section.",
    )

    p_refresh = sub.add_parser(
        "refresh-asn-names",
        help="Rebuild the frontend ASN \u2192 operator-name JSON from bgp.tools.",
    )
    p_refresh.add_argument(
        "--metrics",
        type=Path,
        required=True,
        help="Path to metrics.json the labels should be scoped to.",
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


def _emit_json(result: object, out_path: Path | None) -> int:
    """Serialise ``result`` to ``out_path`` or stdout, return exit code 0.

    Shared by every subcommand that produces a JSON payload (analyze,
    diff, metrics) so the on-disk format is identical regardless of
    caller. ``sort_keys=True`` and a trailing newline keep the output
    byte-stable across runs so reruns against the same input only
    diff when the payload actually changed.
    """
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
    # Only the sources actually pointed at a directory are passed
    # through, so ``metrics --data-dir X`` (no snapshot flags) keeps
    # emitting the snapshot-free payload unchanged.
    snapshot_sources = {
        source: directory
        for source, directory in (
            ("kit", args.kit_dir),
            ("bitnodes", args.bitnodes_dir),
        )
        if directory is not None
    }
    result = generate_dashboard_data(
        args.data_dir, snapshot_sources=snapshot_sources or None
    )
    return _emit_json(result, args.out)


def _run_refresh_asn_names(args: argparse.Namespace) -> int:
    count = refresh_asn_names(args.metrics, args.out, source_url=args.source_url)
    sys.stderr.write(f"Wrote {count} ASN names to {args.out}\n")
    return 0


# Single-source-of-truth dispatch from subcommand name to handler.
# argparse already rejects unknown commands at parse time (via
# ``required=True`` on add_subparsers), so a KeyError here would be
# a wiring bug rather than user input we need to defend against.
_COMMANDS: dict[str, Callable[[argparse.Namespace], int]] = {
    "analyze": _run_analyze,
    "diff": _run_diff,
    "metrics": _run_metrics,
    "refresh-asn-names": _run_refresh_asn_names,
}


def main(argv: Sequence[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    return _COMMANDS[args.command](args)


if __name__ == "__main__":
    sys.exit(main())
