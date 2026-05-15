"""Tests for asmap_dashboard.cli."""

from __future__ import annotations

import ipaddress
import json

import pytest

from asmap_dashboard.cli import main

from .conftest import write_asmap


def test_analyze_writes_json_to_stdout(tmp_path, capsys):
    """analyze subcommand writes the per-map profile as JSON to stdout."""
    map_path = write_asmap(
        tmp_path / "m.dat", [(ipaddress.IPv4Network("1.0.0.0/8"), 100)]
    )

    rc = main(["analyze", str(map_path)])

    assert rc == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["entries_count"] == 1
    assert payload["unique_asns"] == 1


def test_diff_writes_json_to_stdout(tmp_path, capsys):
    """diff subcommand writes the diff payload as JSON to stdout without node impact."""
    a = write_asmap(tmp_path / "a.dat", [(ipaddress.IPv4Network("1.0.0.0/8"), 100)])
    b = write_asmap(tmp_path / "b.dat", [(ipaddress.IPv4Network("1.0.0.0/8"), 200)])

    rc = main(["diff", str(a), str(b)])

    assert rc == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["reassigned"] == 1
    assert "bitcoin_node_impact" not in payload


def test_diff_with_addrs_enables_node_impact(tmp_path, capsys):
    """Passing --addrs adds a bitcoin_node_impact section to the diff payload."""
    a = write_asmap(tmp_path / "a.dat", [(ipaddress.IPv4Network("1.0.0.0/8"), 100)])
    b = write_asmap(tmp_path / "b.dat", [(ipaddress.IPv4Network("1.0.0.0/8"), 200)])
    addrs = tmp_path / "addrs.txt"
    addrs.write_text("1.2.3.4\n")

    rc = main(["diff", str(a), str(b), "--addrs", str(addrs)])

    assert rc == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["bitcoin_node_impact"]["total_nodes"] == 1
    assert payload["bitcoin_node_impact"]["reassigned"] == 1


def test_metrics_writes_json_to_file(tmp_path):
    """metrics subcommand writes the dashboard payload to the path given via --out."""
    (tmp_path / "data" / "2024").mkdir(parents=True)
    write_asmap(
        tmp_path / "data" / "2024" / "1700000000_asmap.dat",
        [(ipaddress.IPv4Network("1.0.0.0/8"), 100)],
    )
    write_asmap(
        tmp_path / "data" / "2024" / "1700000000_asmap_unfilled.dat",
        [(ipaddress.IPv4Network("1.0.0.0/8"), 100)],
    )
    out = tmp_path / "metrics.json"

    rc = main(
        ["metrics", "--data-dir", str(tmp_path / "data"), "--out", str(out)]
    )

    assert rc == 0
    payload = json.loads(out.read_text())
    assert len(payload["maps"]) == 1
    assert payload["maps"][0]["name"] == "2024/1700000000"
    assert payload["maps"][0]["released_at"] == "2023-11-14"


def test_unknown_command_exits_with_error(capsys):
    """argparse rejects unknown subcommands with a non-zero exit."""
    with pytest.raises(SystemExit) as exc:
        main(["does-not-exist"])
    assert exc.value.code != 0


def test_metrics_without_data_dir_exits_with_error(capsys):
    """metrics requires --data-dir and exits cleanly when it is missing."""
    with pytest.raises(SystemExit) as exc:
        main(["metrics"])
    assert exc.value.code != 0

