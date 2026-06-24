"""Tests for asmap_dashboard.network.snapshots."""

from __future__ import annotations

import csv
import io
import json
from datetime import datetime, timezone

import pytest

from asmap_dashboard.network.snapshots import (
    discover_snapshots,
    load_bitnodes_csv,
    load_kit_dossier,
    load_snapshot,
)

_BITNODES_CSV_HEADER = [
    "export_date",
    "ip_address",
    "port",
    "country",
    "isp",
    "services",
    "protocol_version",
    "user_agent",
    "block_height",
]


def _write_bitnodes_csv(path, rows):
    """Write a bitnod.es-shaped CSV from (export_date, ip, country) tuples.

    Only the three columns the loader reads are meaningful; the rest are
    filled with plausible constants so the on-disk shape matches a real
    export (quoted fields, full column set) rather than a trimmed stand-in.
    """
    buf = io.StringIO()
    writer = csv.writer(buf, quoting=csv.QUOTE_ALL)
    writer.writerow(_BITNODES_CSV_HEADER)
    for export_date, ip, country in rows:
        writer.writerow(
            [
                export_date,
                ip,
                "8333",
                country,
                "Example ISP",
                "1033",
                "70016",
                "/Satoshi:29.0.0/",
                "954621",
            ]
        )
    path.write_text(buf.getvalue())
    return path


def _write_kit(path, entries):
    """Write a KIT-shaped dossier from {ip: (version, asn, country)} entries.

    Keys mirror KIT's Python-repr format so the loader's regex extractor
    is exercised, not bypassed.
    """
    doc = {}
    for ip, (version, asn, country) in entries.items():
        key = f"(IPv{version}Address('{ip}'), 8333)"
        doc[key] = {
            "ipStr": f"{ip}:8333",
            "ip": {"version": version},
            "whois": {"asn": asn, "asn_country_code": country},
        }
    path.write_text(json.dumps(doc))
    return path


def test_load_kit_extracts_ip_asn_country_and_filename_timestamp(tmp_path):
    path = tmp_path / "20260305_121237_dossier.json"
    _write_kit(
        path,
        {
            "5.39.74.166": (4, "16276", "FR"),
            "2a00:1398::1": (6, "34878", "DE"),
        },
    )

    snap = load_kit_dossier(path)

    assert snap.source == "kit"
    # 2026-03-05 12:12:37 UTC.
    assert snap.timestamp == 1772712757
    assert snap.label == "2026-03-05"
    assert {n.ip for n in snap.nodes} == {"5.39.74.166", "2a00:1398::1"}
    by_ip = {n.ip: n for n in snap.nodes}
    assert by_ip["5.39.74.166"].asn == 16276
    assert by_ip["5.39.74.166"].country == "FR"
    assert by_ip["5.39.74.166"].version == 4
    assert by_ip["2a00:1398::1"].version == 6


def test_load_kit_counts_unparseable_keys_as_unresolved(tmp_path):
    path = tmp_path / "20240105_125503_dossier.json"
    doc = {
        "(IPv4Address('1.2.3.4'), 8333)": {
            "whois": {"asn": "1", "asn_country_code": "US"}
        },
        "garbage-key-without-address": {"whois": {}},
    }
    path.write_text(json.dumps(doc))

    snap = load_kit_dossier(path)

    assert len(snap.nodes) == 1
    assert snap.unresolved_skipped == 1


def test_load_bitnodes_good_full_form_parses_asn_and_country(tmp_path):
    path = tmp_path / "1755187432.json"
    doc = {
        "timestamp": 1755187432,
        "nodes": {
            # Full 13-element array: country@7, AS@11.
            "103.106.90.72:8333": [
                70016,
                "/Satoshi:29.0.0/",
                1754972601,
                3081,
                910036,
                "host",
                "Perth",
                "AU",
                -31.9,
                115.8,
                "Australia/Perth",
                "AS134090",
                "Leaptel",
            ],
            "[2a01:4f8::1]:8333": [
                70016,
                "/Satoshi:27.0.0/",
                1754972601,
                3081,
                910036,
                "host",
                "Falkenstein",
                "DE",
                50.0,
                12.0,
                "Europe/Berlin",
                "AS24940",
                "Hetzner",
            ],
            "abc.onion:8333": [70016, "/Satoshi:28.1.0/", 1, 1, 1],
        },
    }
    path.write_text(json.dumps(doc))

    snap = load_snapshot(path, "bitnodes")

    assert snap.timestamp == 1755187432
    assert snap.onion_skipped == 1
    by_ip = {n.ip: n for n in snap.nodes}
    assert by_ip["103.106.90.72"].asn == 134090
    assert by_ip["103.106.90.72"].country == "AU"
    assert by_ip["2a01:4f8::1"].asn == 24940
    assert by_ip["2a01:4f8::1"].version == 6


def test_load_bitnodes_good_compact_form_has_no_annotations(tmp_path):
    path = tmp_path / "1762444952.json"
    doc = {
        "timestamp": 1762444952,
        "nodes": {
            # Compact 5-element array: no geo, no ASN.
            "176.66.85.219:8333": [70016, "/Satoshi:30.0.0/", 1, 3145, 946319],
            "xyz.onion:8333": [70016, "/Satoshi:30.0.0/", 1, 3145, 946319],
        },
    }
    path.write_text(json.dumps(doc))

    snap = load_snapshot(path, "bitnodes")

    assert len(snap.nodes) == 1
    [node] = snap.nodes
    assert node.ip == "176.66.85.219"
    assert node.asn is None
    assert node.country is None


def test_load_bitnodes_old_best_effort_list_form(tmp_path):
    path = tmp_path / "1704672612.json"
    doc = [
        # 15-element row: addr@0, country@9, AS@13.
        [
            "2a01:4f8:c0c:ce05::1",
            8333,
            70016,
            "/Satoshi:23.0.0/",
            1694271316,
            1033,
            824795,
            "host",
            None,
            "DE",
            51.3,
            9.5,
            "Europe/Berlin",
            "AS24940",
            "Hetzner Online GmbH",
        ],
        # TOR row: addr@0 is an onion, must be dropped.
        [
            "jqim4bwjwo5ajha4iiedh4vxtjmjy6rrnvnyqt32gym4u5yeeycnrwid.onion",
            8333,
            70016,
            "/Satoshi:23.0.0/",
            1704546883,
            1037,
            824795,
            None,
            None,
            None,
            0.0,
            0.0,
            None,
            "TOR",
            "Tor network",
        ],
    ]
    path.write_text(json.dumps(doc))

    snap = load_snapshot(path, "bitnodes")

    # Timestamp falls back to the filename stem (list form has no header).
    assert snap.timestamp == 1704672612
    assert snap.onion_skipped == 1
    [node] = snap.nodes
    assert node.ip == "2a01:4f8:c0c:ce05::1"
    assert node.asn == 24940
    assert node.country == "DE"


def test_load_bitnodes_without_any_timestamp_is_rejected(tmp_path):
    """A crawl with no embedded timestamp and a non-numeric filename
    must raise instead of silently dating itself 1970-01-01."""
    path = tmp_path / "notes.json"
    path.write_text(json.dumps({"nodes": {"1.2.3.4:8333": [70016, "/x/", 1, 1, 1]}}))

    with pytest.raises(ValueError, match="no capture timestamp"):
        load_snapshot(path, "bitnodes")


def test_discover_snapshots_warns_and_skips_bad_files(tmp_path, capsys):
    """Corrupt or undatable files are skipped with a stderr warning,
    not silently dropped and not fatal to the healthy rest."""
    (tmp_path / "1762444952.json").write_text(
        json.dumps(
            {
                "timestamp": 1762444952,
                "nodes": {"1.2.3.4:8333": [70016, "/x/", 1, 1, 1]},
            }
        )
    )
    (tmp_path / "corrupt.json").write_text("{not json")

    snaps = discover_snapshots(tmp_path, "bitnodes")

    assert [s.timestamp for s in snaps] == [1762444952]
    err = capsys.readouterr().err
    assert "corrupt.json" in err
    assert "skipping" in err


def test_discover_snapshots_recurses_and_sorts_by_time(tmp_path):
    sub = tmp_path / "old best effort"
    sub.mkdir()
    # Newer good-match file at the root.
    (tmp_path / "1762444952.json").write_text(
        json.dumps(
            {
                "timestamp": 1762444952,
                "nodes": {"1.2.3.4:8333": [70016, "/x/", 1, 1, 1]},
            }
        )
    )
    # Older best-effort file in the subfolder.
    (sub / "1704672612.json").write_text(
        json.dumps([["5.6.7.8", 8333, 70016, "/x/", 1, 1, 1]])
    )

    snaps = discover_snapshots(tmp_path, "bitnodes")

    assert [s.timestamp for s in snaps] == [1704672612, 1762444952]


def test_discover_snapshots_skips_kit_dossier_with_nonobject_node(tmp_path, capsys):
    """A KIT node value that is valid JSON but not an object (so
    ``value.get`` would raise AttributeError) is skipped per-file with a
    warning, leaving the healthy dossier in the series."""
    good = tmp_path / "20240105_120000_dossier.json"
    _write_kit(good, {"1.2.3.4": (4, "1", "US")})
    bad = tmp_path / "20240106_120000_dossier.json"
    bad.write_text(json.dumps({"(IPv4Address('5.6.7.8'), 8333)": "not-an-object"}))

    snaps = discover_snapshots(tmp_path, "kit")

    assert [s.label for s in snaps] == ["2024-01-05"]
    err = capsys.readouterr().err
    assert "20240106_120000_dossier.json" in err
    assert "skipping" in err


def test_discover_snapshots_skips_bitnodes_nodes_as_array(tmp_path, capsys):
    """A good-matches file whose ``nodes`` is a JSON array (so ``.items()``
    would raise AttributeError) is skipped, not fatal to the run."""
    (tmp_path / "1762444952.json").write_text(
        json.dumps(
            {
                "timestamp": 1762444952,
                "nodes": {"1.2.3.4:8333": [70016, "/x/", 1, 1, 1]},
            }
        )
    )
    (tmp_path / "1762444953.json").write_text(
        json.dumps({"timestamp": 1762444953, "nodes": [["1.2.3.4:8333", 1]]})
    )

    snaps = discover_snapshots(tmp_path, "bitnodes")

    assert [s.timestamp for s in snaps] == [1762444952]
    err = capsys.readouterr().err
    assert "1762444953.json" in err
    assert "skipping" in err


def test_load_bitnodes_old_numeric_country_loads_without_crash(tmp_path):
    """A bare-list row carrying a numeric country field must not crash the
    loader; the node loads with country=None instead."""
    path = tmp_path / "1704672612.json"
    # 15-element row (>= the 14-min that triggers asn/country extraction),
    # but country@9 is a number instead of the usual ISO string.
    row = [
        "9.9.9.9",
        8333,
        70016,
        "/x/",
        1,
        1,
        1,
        "host",
        None,
        0,
        51.3,
        9.5,
        "Europe/Berlin",
        "AS24940",
        "Hetzner",
    ]
    path.write_text(json.dumps([row]))

    snap = load_snapshot(path, "bitnodes")

    [node] = snap.nodes
    assert node.ip == "9.9.9.9"
    assert node.asn == 24940
    assert node.country is None


def _noon_utc(iso_date):
    """Unix timestamp for ``iso_date`` at 12:00 UTC (the CSV anchor)."""
    y, m, d = (int(part) for part in iso_date.split("-"))
    return int(datetime(y, m, d, 12, tzinfo=timezone.utc).timestamp())


def test_load_bitnodes_csv_parses_clearnet_drops_onion_and_dates_by_newest(tmp_path):
    path = tmp_path / "bitcoin_nodes_2026-06-21.csv"
    _write_bitnodes_csv(
        path,
        [
            ("2026-06-21", "1.1.171.38", "Thailand"),
            ("2026-06-20", "2a01:4f8::1", "Germany"),
            # Onion peers carry no resolvable IP and must drop out.
            ("2026-06-21", "abc.onion", "n/a"),
        ],
    )

    snap = load_bitnodes_csv(path)

    # bitnod.es exports surface as their own "bitmex" series, not "bitnodes".
    assert snap.source == "bitmex"
    # Newest export_date in the file, anchored at noon UTC.
    assert snap.timestamp == _noon_utc("2026-06-21")
    assert snap.label == "2026-06-21"
    assert snap.onion_skipped == 1
    by_ip = {n.ip: n for n in snap.nodes}
    assert set(by_ip) == {"1.1.171.38", "2a01:4f8::1"}
    # No AS number in the CSV, so every node is unannotated; country is kept.
    assert by_ip["1.1.171.38"].asn is None
    assert by_ip["1.1.171.38"].country == "THAILAND"
    assert by_ip["1.1.171.38"].version == 4
    assert by_ip["2a01:4f8::1"].version == 6


def test_load_bitnodes_csv_drops_stale_last_seen_tail(tmp_path):
    """Rows last seen before the 2-day window are the decay tail and must
    not count toward the snapshot's reachable set."""
    path = tmp_path / "bitcoin_nodes_2026-06-21.csv"
    _write_bitnodes_csv(
        path,
        [
            ("2026-06-21", "1.1.171.38", "Thailand"),  # newest day: kept
            ("2026-06-20", "9.9.9.9", "United States"),  # within window: kept
            ("2026-05-23", "2.2.2.2", "France"),  # ~4 weeks stale: dropped
        ],
    )

    snap = load_bitnodes_csv(path)

    assert {n.ip for n in snap.nodes} == {"1.1.171.38", "9.9.9.9"}
    # observed_total counts only the rows inside the window, so the
    # diagnostics describe the snapshot population, not the whole file.
    assert snap.observed_total == 2


def test_load_bitnodes_csv_without_parseable_date_is_rejected(tmp_path):
    path = tmp_path / "bitcoin_nodes_bad.csv"
    _write_bitnodes_csv(path, [("not-a-date", "1.1.171.38", "Thailand")])

    with pytest.raises(ValueError, match="export_date"):
        load_bitnodes_csv(path)


def test_load_snapshot_routes_csv_through_bitnodes_loader(tmp_path):
    path = tmp_path / "bitcoin_nodes_2026-05-22.csv"
    _write_bitnodes_csv(path, [("2026-05-22", "5.6.7.8", "United States")])

    snap = load_snapshot(path, "bitnodes")

    # The CSV dispatch stamps the bitnod.es series, not the b10c one.
    assert snap.source == "bitmex"
    assert snap.timestamp == _noon_utc("2026-05-22")
    assert [n.ip for n in snap.nodes] == ["5.6.7.8"]


def test_discover_snapshots_loads_csv_alongside_json(tmp_path):
    """A Bitnodes directory mixing the b10c JSON crawls and the bitnod.es
    CSV exports loads both, ordered by capture time, each tagged with its
    own source so the regrouping in the pipeline can split them."""
    (tmp_path / "1762444952.json").write_text(
        json.dumps(
            {
                "timestamp": 1762444952,
                "nodes": {"1.2.3.4:8333": [70016, "/x/", 1, 1, 1]},
            }
        )
    )
    sub = tmp_path / "bitmex"
    sub.mkdir()
    _write_bitnodes_csv(
        sub / "bitcoin_nodes_2026-06-21.csv",
        [("2026-06-21", "5.6.7.8", "United States")],
    )

    snaps = discover_snapshots(tmp_path, "bitnodes")

    assert [s.timestamp for s in snaps] == [1762444952, _noon_utc("2026-06-21")]
    assert {s.timestamp: s.source for s in snaps} == {
        1762444952: "bitnodes",
        _noon_utc("2026-06-21"): "bitmex",
    }


def test_unknown_source_is_rejected(tmp_path):
    path = tmp_path / "x.json"
    path.write_text("{}")
    with pytest.raises(ValueError, match="unknown snapshot source"):
        load_snapshot(path, "nope")
