// Shared bar geometry for the map-delta and stacked drift charts. Keeping
// widths and corner radius in one place keeps both charts a visually
// consistent pair under the same range picker.

// Uniform width avoids a "fatter bar = bigger value" misreading. Sized from
// the smallest neighbour gap so dense clusters don't overlap and sparse ranges
// don't render lone chart-wide blocks.
const MIN_BAR_WIDTH = 3;
const MAX_BAR_WIDTH = 14;
const BAR_FILL_FRACTION = 0.7;

// Outer-corner rounding (px) so a bar - or whole stack - reads as one
// rounded shape, not a sharp rectangle.
export const BAR_CORNER_RADIUS = 2;

// Width from the smallest gap between adjacent slot timestamps, clamped to
// [MIN_BAR_WIDTH, MAX_BAR_WIDTH]. Falls back to MAX_BAR_WIDTH for a single
// slot, and to plot width when gaps collapse to zero.
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
