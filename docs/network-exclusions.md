# Network metric exclusions

Deliberate, documented exceptions to how the Network tab scores observed nodes. Raw snapshots always keep every clearnet peer; exclusions only change which peers enter *derived* Network metrics (every card, trend, decay curve, attribution check, and node-impact figure on that tab). Add a new section here when another carve-out appears — the dashboard page links here so readers do not have to reverse-engineer the numbers.

Related: [metrics.md](metrics.md) (what each Network number means), [architecture.md](architecture.md) (pipeline map).

## Active rules

### AS63949 `/Satoshi:27.0.0/` fleet

| | |
| --- | --- |
| **Rule id** | `as63949_satoshi_27` |
| **Match** | Peer `user_agent` containing `/Satoshi:27.0.0/` **and** AS `63949` from either the ASmap lookup **or** the crawler/WHOIS annotation |
| **Affects** | The whole Network-tab population: reachable nodes, coverage, bucketing, HHI / top operators / ASes to 50 %, decay curves, ASN attribution agreement, latest-update / pair node-impact, and the WHOIS coverage denominator |
| **Does not affect** | On-disk snapshot files (JSON/CSV in the `network-snapshots` release), Maps-tab metrics, or Diff Explorer prefix diffs |
| **Approx. size** | On the order of ~950 hosts in recent bitnod.es crawls (varies by day; `0` when the signature is absent) |
| **Code** | [`asmap_dashboard/network/metrics.py`](../asmap_dashboard/network/metrics.py) (`NETWORK_EXCLUDE_*`, `_network_metric_nodes`); UA loaded in [`asmap_dashboard/network/snapshots.py`](../asmap_dashboard/network/snapshots.py) |
| **Payload** | Each snapshot under `network.json` carries `network_exclusions.excluded_nodes` and the active `rules` list so the UI can quote today's count |

**Why.** After the archive→bitnod.es handoff, AS63949 (Akamai / Linode) jumped to the largest observed clearnet share. Most of that jump is one homogeneous fleet advertising `/Satoshi:27.0.0/`, discussed in the Bitcoin Network Operations Collective thread [Small getaddr responses from ~900 nodes (/Satoshi:27.0.0/ on AS63949)](https://bnoc.xyz/t/small-getaddr-responses-from-897-nodes-satoshi-27-0-0-on-as63949/121) (dashboard note in [post #11](https://bnoc.xyz/t/small-getaddr-responses-from-897-nodes-satoshi-27-0-0-on-as63949/121/11)). Counting them as ordinary Bitcoin peers would dominate every Network-tab figure without reflecting typical peer diversity. Genuine AS63949 peers with other user agents stay in the numbers.

**When the fleet disappears.** The filter is a pure predicate: if nothing matches, `excluded_nodes` is `0` and every metric scores the full clearnet set — same arithmetic as before the rule existed (no empty-set special cases beyond the usual “nothing mapped” paths). The Limitations note still documents the rule so a quiet day does not erase the methodology.

**On the page.** The Network tab has a **Limitations** section (same section chrome as Network / Trends) with the caveat in the lede and inline links to this document and the BNOC thread. The UI does not quote a live host count.

## Adding another exclusion later

1. Define a stable `id`, exact match fields, and confirm it applies to the whole Network population (or document a narrower scope deliberately).
2. Implement + test in `_is_excluded_network_node` / `_network_metric_nodes`; keep raw snapshots unchanged.
3. Document the rule in this file and update the Network tab Limitations copy (and `docs/metrics.md` where needed).
4. Bump `SCHEMA_VERSION` if the payload shape or metric semantics change.
