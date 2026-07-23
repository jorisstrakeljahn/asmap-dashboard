"""Network-tap pipeline: observed-node snapshots vs the ASmap history.

The Maps tab answers "how did the ASmap binary change?". This package
answers the orthogonal question the proposal calls the *network tap*:
"how does the ASmap binary behave against the IPs Bitcoin nodes are
actually announced on?".

It is deliberately a separate subpackage from the per-map ``analyze`` /
``diff`` pipeline because its inputs come from outside asmap-data
(public Bitnodes crawler snapshots). ``generate_dashboard_data``
only attaches the ``network`` section when a caller passes snapshot
sources, so the public Maps/Diff payload stays byte-for-byte unchanged
when no snapshots are available.

The archive and daily export shapes normalise to the same ``Snapshot`` shape
and source id. Independent WHOIS annotation is an optional preprocessing step.
"""

from asmap_dashboard.network.snapshots import (
    Node,
    Snapshot,
    discover_snapshots,
    load_snapshot,
)

__all__ = [
    "Node",
    "Snapshot",
    "discover_snapshots",
    "load_snapshot",
]
