"""Tests for asmap_dashboard.cli."""

from __future__ import annotations

import ipaddress
import json

import pytest

from asmap_dashboard.cli import main
from asmap_dashboard.metrics import SCHEMA_VERSION

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
    """metrics --out splits the payload into maps + diffs files."""
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

    rc = main(["metrics", "--data-dir", str(tmp_path / "data"), "--out", str(out)])

    assert rc == 0
    payload = json.loads(out.read_text())
    assert payload["schema_version"] == SCHEMA_VERSION
    assert len(payload["maps"]) == 1
    assert payload["maps"][0]["name"] == "2024/1700000000"
    assert payload["maps"][0]["released_at"] == "2023-11-14"
    # The all-pairs diffs land in a sibling file, not in the maps doc.
    assert "diffs" not in payload
    diffs = json.loads((tmp_path / "diffs.json").read_text())
    assert diffs["schema_version"] == SCHEMA_VERSION
    assert diffs["diffs"] == []
    # No snapshot sources -> no network payload is written.
    assert not (tmp_path / "network.json").exists()


def test_metrics_writes_network_payload_when_sources_given(tmp_path):
    """--kit-dir produces a third file carrying only the network section."""
    (tmp_path / "data" / "2024").mkdir(parents=True)
    write_asmap(
        tmp_path / "data" / "2024" / "1700000000_asmap_unfilled.dat",
        [(ipaddress.IPv4Network("1.0.0.0/8"), 100)],
    )
    kit_dir = tmp_path / "kit"
    kit_dir.mkdir()
    (kit_dir / "20240315_120000_dossier.json").write_text(
        json.dumps({"(IPv4Address('1.1.1.1'), 8333)": {"whois": {"asn": "100"}}})
    )
    out = tmp_path / "metrics.json"

    rc = main(
        [
            "metrics",
            "--data-dir",
            str(tmp_path / "data"),
            "--out",
            str(out),
            "--kit-dir",
            str(kit_dir),
        ]
    )

    assert rc == 0
    assert "network" not in json.loads(out.read_text())
    network = json.loads((tmp_path / "network.json").read_text())
    assert network["schema_version"] == SCHEMA_VERSION
    assert "kit" in network["network"]["sources"]


def test_metrics_stdout_keeps_combined_payload(tmp_path, capsys):
    """Without --out the full document goes to stdout in one piece."""
    (tmp_path / "data" / "2024").mkdir(parents=True)
    write_asmap(
        tmp_path / "data" / "2024" / "1700000000_asmap_unfilled.dat",
        [(ipaddress.IPv4Network("1.0.0.0/8"), 100)],
    )

    rc = main(["metrics", "--data-dir", str(tmp_path / "data")])

    assert rc == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["schema_version"] == SCHEMA_VERSION
    assert "maps" in payload
    assert "diffs" in payload


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
