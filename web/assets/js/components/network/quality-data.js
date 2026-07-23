// Pure selection logic for the ASN-attribution quality card.
export function crossCheckSummary(network, sources, primary) {
    const primarySnapshots = network.sources[primary]?.snapshots ?? [];
    const latestSnapshot = primarySnapshots.at(-1);
    if (!latestSnapshot?.cross_check) return null;

    const rows = [];
    for (const source of sources) {
        for (const snapshot of network.sources[source]?.snapshots ?? []) {
            if (!snapshot.cross_check) continue;
            rows.push({
                source,
                label: snapshot.label,
                ts: snapshot.timestamp * 1000,
                cc: snapshot.cross_check,
            });
        }
    }
    rows.sort((a, b) => b.ts - a.ts);
    return {
        latest: {
            source: primary,
            label: latestSnapshot.label,
            ts: latestSnapshot.timestamp * 1000,
            cc: latestSnapshot.cross_check,
        },
        values: rows.map((row) => row.cc.agreement_pct),
    };
}
