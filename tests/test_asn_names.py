"""Tests for asmap_dashboard.asn_names."""

from __future__ import annotations

import io
import json
from unittest.mock import patch

import pytest

from asmap_dashboard import asn_names


def test_extract_asns_collects_top_movers_and_counterparts():
    """Every asn and primary_counterpart in any diff ends up in the set."""
    metrics = {
        "diffs": [
            {
                "top_movers": [
                    {"asn": 7018, "primary_counterpart": 2386},
                    {"asn": 174, "primary_counterpart": 0},
                ],
            },
            {
                "top_movers": [
                    {"asn": 7018, "primary_counterpart": 16509},
                ],
            },
        ],
    }

    assert asn_names.extract_asns(metrics) == {7018, 2386, 174, 16509}


def test_extract_asns_drops_zero_and_missing():
    """ASN 0 is the unmapped sentinel; missing fields must not crash."""
    metrics = {
        "diffs": [
            {"top_movers": [{"asn": 0, "primary_counterpart": 0}]},
            {"top_movers": [{"asn": 174}]},
            {"top_movers": [{}]},
        ],
    }

    assert asn_names.extract_asns(metrics) == {174}


def test_extract_asns_handles_empty_payload():
    """A payload without diffs returns an empty set instead of raising."""
    assert asn_names.extract_asns({}) == set()
    assert asn_names.extract_asns({"diffs": []}) == set()


def test_parse_csv_extracts_asn_name_pairs():
    """A well-formed bgp.tools CSV is parsed into {asn: name}."""
    body = (
        "asn,name,iso2cc,class\n"
        "174,Cogent Communications,US,t1\n"
        '16509,"Amazon.com, Inc.",US,cloud\n'
        "13335,Cloudflare,US,cloud\n"
    )

    parsed = asn_names.parse_csv(body)

    assert parsed == {
        174: "Cogent Communications",
        16509: "Amazon.com, Inc.",
        13335: "Cloudflare",
    }


def test_parse_csv_skips_invalid_rows():
    """Rows missing a numeric ASN or a name are dropped, not propagated."""
    body = (
        "asn,name\n"
        "174,Cogent Communications\n"
        "notanumber,Bad Row\n"
        "999,\n"
        ",Empty Asn\n"
    )

    assert asn_names.parse_csv(body) == {174: "Cogent Communications"}


def test_parse_csv_accepts_bgp_tools_as_prefix():
    """bgp.tools writes ASNs as 'AS<num>'; the prefix is stripped silently."""
    body = (
        "asn,name,class,cc\n"
        "AS174,Cogent Communications,t1,US\n"
        '"AS16509","Amazon.com, Inc.",cloud,US\n'
        "AS13335,Cloudflare,cloud,US\n"
    )

    assert asn_names.parse_csv(body) == {
        174: "Cogent Communications",
        16509: "Amazon.com, Inc.",
        13335: "Cloudflare",
    }


def test_build_subset_keeps_only_wanted_asns_and_sorts():
    """Output contains exactly the intersection, JSON-stringified and sorted."""
    all_names = {174: "Cogent", 7018: "AT&T", 16509: "Amazon", 13335: "Cloudflare"}
    wanted = [16509, 174, 99999]

    subset = asn_names.build_subset(wanted, all_names)

    assert list(subset.keys()) == ["174", "16509"]
    assert subset == {"174": "Cogent", "16509": "Amazon"}


def test_refresh_writes_subset_and_about_section(tmp_path):
    """End-to-end: refresh reads metrics, fetches names, writes the JSON."""
    metrics_path = tmp_path / "metrics.json"
    metrics_path.write_text(
        json.dumps({
            "diffs": [
                {"top_movers": [
                    {"asn": 174, "primary_counterpart": 7018},
                    {"asn": 16509, "primary_counterpart": 13335},
                ]},
            ],
        })
    )
    out_path = tmp_path / "asn-names.json"

    fake_csv = (
        "asn,name,iso2cc,class\n"
        "174,Cogent Communications,US,t1\n"
        "7018,AT&T,US,t1\n"
        "16509,Amazon,US,cloud\n"
        "13335,Cloudflare,US,cloud\n"
        "99999,Should Not Appear,US,other\n"
    ).encode("utf-8")

    with patch(
        "asmap_dashboard.asn_names.urllib.request.urlopen",
        return_value=_fake_response(fake_csv),
    ):
        count = asn_names.refresh(metrics_path, out_path)

    assert count == 4
    payload = json.loads(out_path.read_text())
    assert payload["_about"]["asn_count"] == 4
    assert payload["_about"]["source"] == asn_names.BGP_TOOLS_URL
    assert payload["174"] == "Cogent Communications"
    assert payload["7018"] == "AT&T"
    assert payload["16509"] == "Amazon"
    assert payload["13335"] == "Cloudflare"
    assert "99999" not in payload


def test_refresh_with_no_matching_asns_writes_empty_subset(tmp_path):
    """If bgp.tools has none of the wanted ASNs, the file still gets written."""
    metrics_path = tmp_path / "metrics.json"
    metrics_path.write_text(
        json.dumps({"diffs": [{"top_movers": [{"asn": 999999}]}]})
    )
    out_path = tmp_path / "asn-names.json"
    fake_csv = b"asn,name\n174,Cogent\n"

    with patch(
        "asmap_dashboard.asn_names.urllib.request.urlopen",
        return_value=_fake_response(fake_csv),
    ):
        count = asn_names.refresh(metrics_path, out_path)

    assert count == 0
    payload = json.loads(out_path.read_text())
    assert payload["_about"]["asn_count"] == 0
    assert {k for k in payload if not k.startswith("_")} == set()


def _fake_response(body: bytes):
    """Minimal urlopen() stand-in supporting the context manager protocol."""
    class _Response(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *_exc):
            self.close()
            return False

    return _Response(body)
