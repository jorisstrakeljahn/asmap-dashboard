"""Command-line entry point for the analysis pipeline."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Optional, Sequence

from asmap_dashboard.analyze import analyze_map
from asmap_dashboard.diff import diff_maps
from asmap_dashboard.metrics import generate_dashboard_data


def main(argv: Optional[Sequence[str]] = None) -> int:
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

    args = parser.parse_args(argv)

    if args.command == "analyze":
        result = analyze_map(args.map)
    elif args.command == "diff":
        result = diff_maps(args.map_a, args.map_b, addrs_file=args.addrs)
    elif args.command == "metrics":
        result = generate_dashboard_data(args.data_dir)
    else:
        parser.error(f"unknown command {args.command}")
        return 2

    payload = json.dumps(result, indent=2, sort_keys=True)
    if getattr(args, "out", None) is not None:
        args.out.write_text(payload + "\n")
    else:
        sys.stdout.write(payload + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
