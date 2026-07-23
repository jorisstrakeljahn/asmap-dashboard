export const TARGET_STALENESS_DAYS = 365;

// Read a decay curve at one year of map age. Interpolate between surrounding
// builds; with one-sided history, scale the nearest point through the origin.
export function stalenessAtTarget(
    decay,
    targetDays = TARGET_STALENESS_DAYS,
) {
    const points = (decay?.points ?? [])
        .filter((point) => point.age_days > 0)
        .sort((a, b) => a.age_days - b.age_days);
    if (points.length === 0) return null;

    let lower = null;
    let upper = null;
    for (const point of points) {
        if (point.age_days <= targetDays) lower = point;
        if (point.age_days >= targetDays) {
            upper = point;
            break;
        }
    }

    if (lower && upper) {
        const span = upper.age_days - lower.age_days;
        if (span === 0) {
            return { interpolated: false, value: lower.drift_pct, point: lower };
        }
        const fraction = (targetDays - lower.age_days) / span;
        return {
            interpolated: true,
            value: lower.drift_pct + fraction * (upper.drift_pct - lower.drift_pct),
            lower,
            upper,
        };
    }

    const nearest = lower ?? upper;
    return {
        interpolated: false,
        value: (nearest.drift_pct * targetDays) / nearest.age_days,
        point: nearest,
    };
}
