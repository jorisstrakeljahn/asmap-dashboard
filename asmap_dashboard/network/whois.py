"""Independent IP-to-ASN attribution with a byte-stable on-disk cache.

The public bitnod.es CSVs contain node IPs but no ASN. This module defines
the boundary for obtaining that independent attribution without confusing it
with an ASmap lookup. ``TeamCymruWhoisResolver`` uses Team Cymru's bulk WHOIS
service, while ``CachedWhoisResolver`` limits repeat queries and records
temporary misses.

Fixture files can keep the small record shape::

    {"records":{"192.0.2.1":{"asn":64496,"country":"DE"}}}

The cache adds ``checked_at`` Unix timestamps and a timestamped ``misses``
object. It contains raw node IPs and must remain local. Only aggregate metrics
derived from the newest annotated snapshot belong in the public payload.
"""

from __future__ import annotations

import ipaddress
import json
import socket
import time
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Protocol

from asmap_dashboard.loader import PathLike

TEAM_CYMRU_HOST = "whois.cymru.com"
TEAM_CYMRU_PORT = 43
TEAM_CYMRU_BATCH_SIZE = 10_000


@dataclass(frozen=True)
class WhoisRecord:
    """Independent WHOIS attribution for one IP address."""

    asn: int
    country: str | None = None
    checked_at: int | None = None


class WhoisResolver(Protocol):
    """Resolve a batch of IPs without exposing transport details."""

    provider: str

    def resolve_many(self, ips: Sequence[str]) -> Mapping[str, WhoisRecord]:
        """Return records for the subset of ``ips`` the resolver knows."""


class JsonWhoisStore:
    """Local JSON store used by fixtures and the persistent cache."""

    provider = "local-cache"

    def __init__(self, path: PathLike) -> None:
        self.path = Path(path)
        self._records, self._misses = self._load()

    def resolve_many(self, ips: Sequence[str]) -> Mapping[str, WhoisRecord]:
        return {ip: self._records[ip] for ip in ips if ip in self._records}

    def missed_many(self, ips: Sequence[str]) -> Mapping[str, int]:
        return {ip: self._misses[ip] for ip in ips if ip in self._misses}

    def update(
        self,
        records: Mapping[str, WhoisRecord],
        *,
        checked_ips: Sequence[str] | None = None,
        checked_at: int | None = None,
    ) -> None:
        """Persist successful records and negative results from one query."""
        checked = tuple(dict.fromkeys(checked_ips or records))
        if not checked:
            return
        for ip in checked:
            record = records.get(ip)
            if record is None:
                self._records.pop(ip, None)
                if checked_at is not None:
                    self._misses[ip] = checked_at
                continue
            stamped = (
                replace(record, checked_at=checked_at)
                if checked_at is not None
                else record
            )
            self._records[ip] = stamped
            self._misses.pop(ip, None)
        self._write()

    def _write(self) -> None:
        payload = {
            "records": {
                ip: _record_payload(record)
                for ip, record in sorted(self._records.items())
            },
            "misses": dict(sorted(self._misses.items())),
        }
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(f"{self.path.suffix}.tmp")
        temporary.write_text(
            json.dumps(payload, separators=(",", ":"), sort_keys=True) + "\n"
        )
        temporary.replace(self.path)

    def _load(self) -> tuple[dict[str, WhoisRecord], dict[str, int]]:
        if not self.path.exists():
            return {}, {}
        raw = json.loads(self.path.read_text())
        records = raw.get("records", {})
        if not isinstance(records, dict):
            raise ValueError(f"{self.path}: records must be an object")
        out: dict[str, WhoisRecord] = {}
        for ip, value in records.items():
            if not isinstance(ip, str) or not isinstance(value, dict):
                continue
            try:
                asn = int(value["asn"])
            except (KeyError, TypeError, ValueError):
                continue
            country = value.get("country")
            if not isinstance(country, str):
                country = None
            checked_at = value.get("checked_at")
            if not isinstance(checked_at, int):
                checked_at = None
            out[ip] = WhoisRecord(
                asn=asn,
                country=country,
                checked_at=checked_at,
            )
        misses_raw = raw.get("misses", {})
        misses = (
            {
                ip: checked_at
                for ip, checked_at in misses_raw.items()
                if isinstance(ip, str) and isinstance(checked_at, int)
            }
            if isinstance(misses_raw, dict)
            else {}
        )
        return out, misses


def _record_payload(record: WhoisRecord) -> dict:
    payload: dict = {"asn": record.asn, "country": record.country}
    if record.checked_at is not None:
        payload["checked_at"] = record.checked_at
    return payload


class TeamCymruWhoisResolver:
    """Resolve BGP origin ASNs through Team Cymru's bulk WHOIS service."""

    provider = "team-cymru"

    def __init__(
        self,
        *,
        host: str = TEAM_CYMRU_HOST,
        port: int = TEAM_CYMRU_PORT,
        timeout: float = 90,
        batch_size: int = TEAM_CYMRU_BATCH_SIZE,
    ) -> None:
        self.host = host
        self.port = port
        self.timeout = timeout
        self.batch_size = batch_size

    def resolve_many(self, ips: Sequence[str]) -> Mapping[str, WhoisRecord]:
        originals_by_canonical: dict[str, list[str]] = {}
        families: dict[int, list[str]] = {4: [], 6: []}
        for original in dict.fromkeys(ips):
            try:
                parsed = ipaddress.ip_address(original)
            except ValueError:
                continue
            canonical = str(parsed)
            originals = originals_by_canonical.setdefault(canonical, [])
            if not originals:
                families[parsed.version].append(canonical)
            originals.append(original)

        canonical_records: dict[str, WhoisRecord] = {}
        for family_ips in families.values():
            for start in range(0, len(family_ips), self.batch_size):
                batch = family_ips[start : start + self.batch_size]
                canonical_records.update(self._query_batch(batch))

        out: dict[str, WhoisRecord] = {}
        for canonical, record in canonical_records.items():
            for original in originals_by_canonical.get(canonical, ()):
                out[original] = record
        return out

    def _query_batch(self, ips: Sequence[str]) -> dict[str, WhoisRecord]:
        if not ips:
            return {}
        # The server's bulk mode can return an empty response for a one-address
        # request. Its regular verbose form is reliable for that final batch.
        request = (
            f" -v {ips[0]}\n"
            if len(ips) == 1
            else "begin\nverbose\n" + "\n".join(ips) + "\nend\n"
        )
        with socket.create_connection(
            (self.host, self.port),
            timeout=self.timeout,
        ) as connection:
            connection.settimeout(self.timeout)
            connection.sendall(request.encode("ascii"))
            if len(ips) > 1:
                connection.shutdown(socket.SHUT_WR)
            with connection.makefile(
                "r",
                encoding="utf-8",
                errors="replace",
            ) as response:
                records = _parse_team_cymru_response(response)
        if not records:
            raise RuntimeError(
                f"Team Cymru returned no usable records for {len(ips)} IPs"
            )
        return records


def _parse_team_cymru_response(lines: Iterable[str]) -> dict[str, WhoisRecord]:
    """Parse verbose bulk rows, skipping banners and ambiguous origin sets."""
    out: dict[str, WhoisRecord] = {}
    for line in lines:
        fields = [field.strip() for field in line.split("|")]
        if len(fields) < 4 or not fields[0].isdigit():
            continue
        try:
            ip = str(ipaddress.ip_address(fields[1]))
        except ValueError:
            continue
        country = fields[3].upper()
        out[ip] = WhoisRecord(
            asn=int(fields[0]),
            country=country if len(country) == 2 else None,
        )
    return out


class CachedWhoisResolver:
    """Resolve fresh cache entries, then batch-fill misses from upstream."""

    def __init__(
        self,
        cache: JsonWhoisStore,
        upstream: WhoisResolver | None = None,
        *,
        max_age_seconds: int | None = None,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.cache = cache
        self.upstream = upstream
        self.max_age_seconds = max_age_seconds
        self.clock = clock
        self.provider = getattr(upstream, "provider", cache.provider)

    def resolve_many(self, ips: Sequence[str]) -> Mapping[str, WhoisRecord]:
        unique_ips = tuple(dict.fromkeys(ips))
        now = int(self.clock())
        cutoff = None if self.max_age_seconds is None else now - self.max_age_seconds
        cached = self.cache.resolve_many(unique_ips)
        resolved = {
            ip: record
            for ip, record in cached.items()
            if cutoff is None
            or (record.checked_at is not None and record.checked_at >= cutoff)
        }
        fresh_misses = {
            ip
            for ip, checked_at in self.cache.missed_many(unique_ips).items()
            if cutoff is not None and checked_at >= cutoff
        }
        missing = [
            ip for ip in unique_ips if ip not in resolved and ip not in fresh_misses
        ]
        if missing and self.upstream is not None:
            fresh = dict(self.upstream.resolve_many(missing))
            self.cache.update(fresh, checked_ips=missing, checked_at=now)
            resolved.update(
                {ip: replace(record, checked_at=now) for ip, record in fresh.items()}
            )
        return resolved
