"""Tests for the independent WHOIS resolver boundary and local cache."""

import io
import json

from asmap_dashboard.network.whois import (
    CachedWhoisResolver,
    JsonWhoisStore,
    TeamCymruWhoisResolver,
    WhoisRecord,
    _parse_team_cymru_response,
)


class _BatchResolver:
    def __init__(self):
        self.calls = []

    def resolve_many(self, ips):
        self.calls.append(list(ips))
        return {ip: WhoisRecord(asn=64500, country="DE") for ip in ips}


def test_cached_resolver_batches_only_misses_and_writes_stable_json(tmp_path):
    cache_path = tmp_path / "whois" / "records.json"
    cache_path.parent.mkdir()
    cache_path.write_text(
        json.dumps({"records": {"1.1.1.1": {"asn": 13335, "country": "US"}}})
    )
    upstream = _BatchResolver()
    resolver = CachedWhoisResolver(
        JsonWhoisStore(cache_path),
        upstream,
        clock=lambda: 1_000,
    )

    records = resolver.resolve_many(["1.1.1.1", "2.2.2.2", "2.2.2.2"])

    assert records["1.1.1.1"].asn == 13335
    assert records["2.2.2.2"].asn == 64500
    assert upstream.calls == [["2.2.2.2"]]
    assert cache_path.read_text() == (
        '{"misses":{},"records":{"1.1.1.1":{"asn":13335,"country":"US"},'
        '"2.2.2.2":{"asn":64500,"checked_at":1000,"country":"DE"}}}\n'
    )


def test_cache_only_resolver_leaves_unknown_ips_unresolved(tmp_path):
    resolver = CachedWhoisResolver(JsonWhoisStore(tmp_path / "missing.json"))

    assert resolver.resolve_many(["192.0.2.1"]) == {}
    assert not (tmp_path / "missing.json").exists()


def test_ttl_refreshes_stale_records_and_caches_misses(tmp_path):
    cache_path = tmp_path / "whois.json"
    cache_path.write_text(
        json.dumps(
            {
                "records": {
                    "1.1.1.1": {
                        "asn": 13335,
                        "country": "US",
                        "checked_at": 950,
                    },
                    "2.2.2.2": {
                        "asn": 64500,
                        "country": "DE",
                        "checked_at": 800,
                    },
                },
                "misses": {"3.3.3.3": 950},
            }
        )
    )
    upstream = _BatchResolver()
    resolver = CachedWhoisResolver(
        JsonWhoisStore(cache_path),
        upstream,
        max_age_seconds=100,
        clock=lambda: 1_000,
    )

    records = resolver.resolve_many(["1.1.1.1", "2.2.2.2", "3.3.3.3", "4.4.4.4"])

    assert records["1.1.1.1"].asn == 13335
    assert records["2.2.2.2"].asn == 64500
    assert "3.3.3.3" not in records
    assert upstream.calls == [["2.2.2.2", "4.4.4.4"]]


def test_negative_results_are_not_requeried_until_ttl_expires(tmp_path):
    class _EmptyResolver:
        provider = "empty"

        def __init__(self):
            self.calls = []

        def resolve_many(self, ips):
            self.calls.append(list(ips))
            return {}

    cache_path = tmp_path / "whois.json"
    upstream = _EmptyResolver()
    resolver = CachedWhoisResolver(
        JsonWhoisStore(cache_path),
        upstream,
        max_age_seconds=100,
        clock=lambda: 1_000,
    )

    assert resolver.resolve_many(["192.0.2.1"]) == {}
    assert resolver.resolve_many(["192.0.2.1"]) == {}
    assert upstream.calls == [["192.0.2.1"]]
    assert json.loads(cache_path.read_text())["misses"]["192.0.2.1"] == 1_000


def test_team_cymru_parser_reads_verbose_rows_and_skips_ambiguous_asns():
    records = _parse_team_cymru_response(
        [
            "Bulk mode; whois.cymru.com",
            "AS | IP | BGP Prefix | CC | Registry | Allocated | AS Name",
            "13335 | 1.1.1.1 | 1.1.1.0/24 | US | arin | 2010-01-01 | Cloudflare",
            "15169 36040 | 2001:4860::1 | 2001:4860::/32 | US | arin | x | Google",
            "NA | 192.0.2.1 | NA | ZZ | NA | NA | NA",
        ]
    )

    assert records == {
        "1.1.1.1": WhoisRecord(asn=13335, country="US"),
    }


def test_team_cymru_queries_ipv4_and_ipv6_in_separate_batches(monkeypatch):
    resolver = TeamCymruWhoisResolver(batch_size=2)
    batches = []

    def fake_query(ips):
        batches.append(list(ips))
        return {ip: WhoisRecord(asn=64500) for ip in ips}

    monkeypatch.setattr(resolver, "_query_batch", fake_query)

    records = resolver.resolve_many(["1.1.1.1", "2.2.2.2", "3.3.3.3", "2001:db8::1"])

    assert batches == [
        ["1.1.1.1", "2.2.2.2"],
        ["3.3.3.3"],
        ["2001:db8::1"],
    ]
    assert set(records) == {
        "1.1.1.1",
        "2.2.2.2",
        "3.3.3.3",
        "2001:db8::1",
    }


def test_team_cymru_frames_single_and_bulk_requests(monkeypatch):
    class _Connection:
        def __init__(self):
            self.sent = b""
            self.shutdown_called = False
            self._body = "13335 | 1.1.1.1 | 1.1.1.0/24 | AU | apnic | x | Cloudflare\n"

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def settimeout(self, _timeout):
            pass

        def sendall(self, payload):
            self.sent = payload

        def shutdown(self, _direction):
            self.shutdown_called = True

        def makefile(self, *_args, **_kwargs):
            return io.StringIO(self._body)

    connection = _Connection()
    monkeypatch.setattr(
        "asmap_dashboard.network.whois.socket.create_connection",
        lambda *_args, **_kwargs: connection,
    )

    resolver = TeamCymruWhoisResolver()
    records = resolver._query_batch(["1.1.1.1"])

    assert connection.sent == b" -v 1.1.1.1\n"
    assert not connection.shutdown_called
    assert records["1.1.1.1"].asn == 13335

    connection.sent = b""
    connection.shutdown_called = False
    connection._body = (
        "Bulk mode; whois.cymru.com\n"
        "13335 | 1.1.1.1 | 1.1.1.0/24 | AU | apnic | x | Cloudflare\n"
        "15169 | 8.8.8.8 | 8.8.8.0/24 | US | arin | x | Google\n"
    )
    records = resolver._query_batch(["1.1.1.1", "8.8.8.8"])

    assert connection.sent == b"begin\nverbose\n1.1.1.1\n8.8.8.8\nend\n"
    assert not connection.shutdown_called
    assert records["1.1.1.1"].asn == 13335
    assert records["8.8.8.8"].asn == 15169


def test_team_cymru_empty_response_includes_preview(monkeypatch):
    class _Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def settimeout(self, _timeout):
            pass

        def sendall(self, _payload):
            pass

        def makefile(self, *_args, **_kwargs):
            return io.StringIO("Error: rate limited\ntry again later\n")

    monkeypatch.setattr(
        "asmap_dashboard.network.whois.socket.create_connection",
        lambda *_args, **_kwargs: _Connection(),
    )

    try:
        TeamCymruWhoisResolver()._query_batch(["1.1.1.1", "8.8.8.8"])
    except RuntimeError as exc:
        assert "no usable records for 2 IPs" in str(exc)
        assert "rate limited" in str(exc)
    else:
        raise AssertionError("expected RuntimeError")
