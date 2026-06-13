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
from asmap_dashboard.metrics import SCHEMA_VERSION, generate_dashboard_data


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
            "are given. Defaults to network.json next to --out. Split "
            "out because it is the one payload that cannot be "
            "regenerated from public inputs (KIT data), so it is the "
            "only one worth committing."
        ),
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

    Shared by every subcommand that produces a JSON payload (analyze,
    diff, metrics) so the on-disk format is identical regardless of
    caller. ``sort_keys=True`` and a trailing newline keep the output
    byte-stable across runs so reruns against the same input only
    diff when the payload actually changed.

    ``compact`` drops the indentation entirely. The metrics payload is
    fetched by the browser on every dashboard load and the pretty-
    printed form is ~25 % larger on the wire for zero reader value (the
    file is far too big to scan by eye anyway); the analyze / diff
    subcommands keep the indented form because their output is meant
    to be read in a terminal.
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

    With ``--out`` the payload is split into three files along its
    natural fault lines:

      - maps + diff summary (``--out``): small. Drives the overview,
        every drift chart, and the Diff Explorer's match banner. Each
        pair diff is carried here with its aggregate fields but
        without its ``top_movers`` roster.
      - diff detail (``--diffs-out``): the per-pair ``top_movers``
        rosters keyed by ``"<from>|<to>"``; ~99 % of the diff bytes,
        only the Top Movers table reads them, so the frontend
        lazy-loads this file when the Diff Explorer tab is first
        opened rather than on initial paint.
      - network (``--network-out``): only written when snapshot
        sources produced a network section; the one part built from
        non-public inputs and therefore the only one committed to git.

    Without ``--out`` everything goes to stdout as one combined
    document with the rosters still nested under each diff (handy for
    piping into jq while debugging).

    Every emitted document carries ``schema_version`` so the frontend
    can reject a payload generation it does not understand.
    """
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
    result["schema_version"] = SCHEMA_VERSION

    if args.out is None:
        return _emit_json(result, None, compact=True)

    out: Path = args.out
    diffs_out: Path = args.diffs_out or out.parent / "diffs.json"
    network_out: Path = args.network_out or out.parent / "network.json"

    network = result.pop("network", None)
    diffs = result.pop("diffs")

    # Split each pair diff into a lightweight summary (the aggregate
    # fields the Maps tab drift/overview and the Diff Explorer's match
    # banner need) and the heavy top_movers roster (only the Top
    # Movers table reads it). The summary rides in metrics.json so the
    # default Maps view renders without fetching the big file; the
    # rosters go to diffs.json keyed by "<from>|<to>" and are
    # lazy-loaded only when the Diff Explorer tab is opened. The
    # rosters are ~99 % of the diff bytes, so this keeps the first
    # paint off a multi-megabyte download and parse.
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


def _run_refresh_asn_names(args: argparse.Namespace) -> int:
    count = refresh_asn_names(args.payload, args.out, source_url=args.source_url)
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
