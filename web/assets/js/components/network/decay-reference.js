const REFERENCES = new Set(["truth", "map"]);

export function defaultDecayReference(network, sources) {
    return sources.some(
        (source) => network.sources[source]?.decay_truth?.points?.length,
    )
        ? "truth"
        : "map";
}

export function resolveDecayReference(network, sources, requested) {
    const fallback = defaultDecayReference(network, sources);
    if (!REFERENCES.has(requested)) return fallback;
    if (requested === "truth" && fallback === "map") return fallback;
    return requested;
}
