"""Network-tap pipeline: observed-node snapshots vs the ASmap history.

The Maps tab answers "how did the ASmap binary change?". This package
answers the orthogonal question the proposal calls the *network tap*:
"how does the ASmap binary behave against the IPs Bitcoin nodes are
actually announced on?".

It is deliberately a separate subpackage from the per-map ``analyze`` /
``diff`` pipeline because its inputs come from outside asmap-data
(node-list snapshots from KIT monitor nodes, Bitnodes crawls, ...) and
those inputs are not guaranteed to be public yet. ``generate_dashboard_data``
only attaches the ``network`` section when a caller passes snapshot
sources, so the public Maps/Diff payload stays byte-for-byte unchanged
when no snapshots are available.

Source-agnostic by design: every snapshot loader returns the same
``Snapshot`` shape (a timestamp plus a list of clearnet ``Node``s), so a
new crawler can be plugged in by writing one loader without touching the
metric code.
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
