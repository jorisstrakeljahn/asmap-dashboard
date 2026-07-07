"""Tests for the network payload merge (CI-generated + committed KIT)."""

import json

import pytest

from asmap_dashboard.cli import main
from asmap_dashboard.network.merge import merge_network_payloads


def _write(path, payload):
    path.write_text(json.dumps(payload))
    return path


def _payload(schema, sources, **extra_top):
    return {
        "schema_version": schema,
        "network": {"reference_timestamp": 1000, "sources": sources, **extra_top},
    }


def test_grafts_missing_source_and_keeps_base_keys(tmp_path):
    base = _write(
        tmp_path / "base.json",
        _payload(8, {"bitmex": {"snapshots": [1]}}, pair_impact={"pairs": {}}),
    )
    extra = _write(
        tmp_path / "extra.json",
        _payload(8, {"kit": {"snapshots": [2]}}, pair_impact={"pairs": {"x": 1}}),
    )

    merged = merge_network_payloads(base, extra)

    assert set(merged["network"]["sources"]) == {"bitmex", "kit"}
    # Base's top-level keys win: the banner reflects the fresh CI node set.
    assert merged["network"]["pair_impact"] == {"pairs": {}}


def test_base_series_wins_over_extra_same_name(tmp_path):
    base = _write(
        tmp_path / "base.json", _payload(8, {"bitmex": {"snapshots": ["fresh"]}})
    )
    extra = _write(
        tmp_path / "extra.json", _payload(8, {"bitmex": {"snapshots": ["stale"]}})
    )

    merged = merge_network_payloads(base, extra)

    assert merged["network"]["sources"]["bitmex"]["snapshots"] == ["fresh"]


def test_schema_mismatch_skips_graft(tmp_path, capsys):
    base = _write(tmp_path / "base.json", _payload(8, {"bitmex": {}}))
    extra = _write(tmp_path / "extra.json", _payload(7, {"kit": {}}))

    merged = merge_network_payloads(base, extra)

    assert set(merged["network"]["sources"]) == {"bitmex"}
    assert "skipping the merge" in capsys.readouterr().err


@pytest.mark.parametrize("missing", ["base", "extra"])
def test_missing_input_falls_back_to_the_other(tmp_path, missing):
    payload = _payload(8, {"kit": {}})
    existing = _write(tmp_path / "existing.json", payload)
    absent = tmp_path / "absent.json"
    args = (absent, existing) if missing == "base" else (existing, absent)

    assert merge_network_payloads(*args) == payload


def test_both_missing_returns_none(tmp_path):
    assert merge_network_payloads(tmp_path / "a.json", tmp_path / "b.json") is None


def test_cli_merge_network_writes_output(tmp_path):
    base = _write(tmp_path / "base.json", _payload(8, {"bitmex": {}}))
    extra = _write(tmp_path / "extra.json", _payload(8, {"kit": {}}))
    out = tmp_path / "out.json"

    rc = main(
        [
            "merge-network",
            "--base",
            str(base),
            "--extra",
            str(extra),
            "--out",
            str(out),
        ]
    )

    assert rc == 0
    merged = json.loads(out.read_text())
    assert set(merged["network"]["sources"]) == {"bitmex", "kit"}


def test_cli_merge_network_missing_inputs_writes_nothing(tmp_path, capsys):
    out = tmp_path / "out.json"

    rc = main(
        [
            "merge-network",
            "--base",
            str(tmp_path / "a.json"),
            "--extra",
            str(tmp_path / "b.json"),
            "--out",
            str(out),
        ]
    )

    assert rc == 0
    assert not out.exists()
    assert "nothing written" in capsys.readouterr().err
