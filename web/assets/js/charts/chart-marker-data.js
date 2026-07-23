// Pure range filtering for optional vertical chart annotations.
export function visibleXMarkers(markers, domainStart, domainEnd) {
    return (markers ?? []).filter(
        (marker) =>
            Number.isFinite(marker.timestamp) &&
            marker.timestamp >= domainStart &&
            marker.timestamp <= domainEnd,
    );
}
