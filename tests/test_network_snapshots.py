"""Tests for asmap_dashboard.network.snapshots."""

from __future__ import annotations

import json

from asmap_dashboard.network.snapshots import (
    discover_snapshots,
    load_kit_dossier,
    load_snapshot,
)


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


def test_unknown_source_is_rejected(tmp_path):
    path = tmp_path / "x.json"
    path.write_text("{}")
    try:
        load_snapshot(path, "nope")
    except ValueError as exc:
        assert "unknown snapshot source" in str(exc)
    else:  # pragma: no cover - the call above must raise
        raise AssertionError("expected ValueError for unknown source")
