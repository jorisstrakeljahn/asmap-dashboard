"""Tests for asmap_dashboard.cli."""

from __future__ import annotations

import ipaddress
import json
from unittest.mock import patch

import pytest

from asmap_dashboard.cli import main
from asmap_dashboard.metrics import SCHEMA_VERSION

from .conftest import fake_urlopen_response, write_asmap


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
    """metrics --out splits the payload into a maps+summary file and a
    detail file carrying the top-mover rosters."""
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
    # The diff summary now rides in metrics.json (a single build means
    # no pairs, hence an empty list); the heavy rosters land in the
    # sibling detail file keyed by "<from>|<to>".
    assert payload["diffs"] == []
    diffs = json.loads((tmp_path / "diffs.json").read_text())
    assert diffs["schema_version"] == SCHEMA_VERSION
    assert diffs["top_movers"] == {}
    # No snapshot sources -> no network payload is written.
    assert not (tmp_path / "network.json").exists()


def test_metrics_splits_top_movers_into_detail_file(tmp_path):
    """With two diffable builds the aggregate fields stay in metrics.json
    while top_movers move to diffs.json keyed by "<from>|<to>"."""
    (tmp_path / "data" / "2024").mkdir(parents=True)
    for ts, asn in (("1700000000", 100), ("1700100000", 200)):
        write_asmap(
            tmp_path / "data" / "2024" / f"{ts}_asmap_unfilled.dat",
            [(ipaddress.IPv4Network("1.0.0.0/8"), asn)],
        )
    out = tmp_path / "metrics.json"

    rc = main(["metrics", "--data-dir", str(tmp_path / "data"), "--out", str(out)])

    assert rc == 0
    summary = json.loads(out.read_text())["diffs"]
    assert len(summary) == 1
    pair = summary[0]
    # Aggregate fields survive in the summary; the roster does not.
    assert pair["reassigned"] == 1
    assert "top_movers" not in pair

    detail = json.loads((tmp_path / "diffs.json").read_text())["top_movers"]
    key = f"{pair['from']}|{pair['to']}"
    assert key in detail
    asns = {row["asn"] for row in detail[key]}
    assert {100, 200} <= asns


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


def test_refresh_asn_names_writes_labels_from_payload(tmp_path):
    """refresh-asn-names scopes labels to the given payload and writes them."""
    payload = tmp_path / "metrics.json"
    payload.write_text(json.dumps({"diffs": [{"top_movers": [{"asn": 174}]}]}))
    out = tmp_path / "asn-names.json"

    with patch(
        "asmap_dashboard.asn_names.urllib.request.urlopen",
        return_value=fake_urlopen_response(b"asn,name\n174,Cogent\n"),
    ):
        rc = main(["refresh-asn-names", "--payload", str(payload), "--out", str(out)])

    assert rc == 0
    assert json.loads(out.read_text())["174"] == "Cogent"


def test_refresh_asn_names_fails_when_all_payloads_missing(tmp_path):
    """A path typo (no payload exists) aborts non-zero instead of writing
    an empty file over a previously good asn-names.json."""
    out = tmp_path / "asn-names.json"

    with pytest.raises(FileNotFoundError):
        main(
            [
                "refresh-asn-names",
                "--payload",
                str(tmp_path / "missing.json"),
                "--out",
                str(out),
            ]
        )

    assert not out.exists()
