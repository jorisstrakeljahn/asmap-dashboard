// Shared geometry for the two history bar charts: the map-delta chart
// (one bar per release) and the stacked drift-per-build chart. Keeping
// the widths, corner radius, and hover bleed in one place means both
// charts pick the same bar sizes under the same range picker and read
// as a visually consistent pair.

// Uniform bar width (no "fatter bar = bigger value" misreading),
// sized from the smallest neighbour gap so dense clusters never
// overlap and sparse ranges don't render lone bars as chart-wide
// blocks.
const MIN_BAR_WIDTH = 3;
const MAX_BAR_WIDTH = 14;
const BAR_FILL_FRACTION = 0.7;

// Outer-corner rounding (px) so a bar — or the whole stack — reads as
// one rounded shape rather than a sharp rectangle.
export const BAR_CORNER_RADIUS = 2;

// Hover tolerance past the plot edge so a touch resolve in the gutter
// still maps to the nearest bar / column.
export const HOVER_BLEED = 12;

// Bar width sized from the smallest gap between adjacent slot
// timestamps, clamped to [MIN_BAR_WIDTH, MAX_BAR_WIDTH]. Falls back to
// MAX_BAR_WIDTH when there is only one slot and to the plot width when
// the gaps collapse to zero.
export function pickBarWidth(timestamps, xScale, plot) {
    if (timestamps.length < 2) return MAX_BAR_WIDTH;
    let minGap = Infinity;
    for (let i = 1; i < timestamps.length; i++) {
        const gap = xScale(timestamps[i]) - xScale(timestamps[i - 1]);
        if (gap > 0 && gap < minGap) minGap = gap;
    }
    if (!Number.isFinite(minGap) || minGap <= 0) {
        return Math.min(MAX_BAR_WIDTH, plot.right - plot.left);
    }
    return Math.max(
        MIN_BAR_WIDTH,
        Math.min(MAX_BAR_WIDTH, minGap * BAR_FILL_FRACTION),
    );
}
