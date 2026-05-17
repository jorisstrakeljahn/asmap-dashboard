// Tiny tween helper for the Overview headline numbers. Stripe /
// Linear / Vercel all count-up the big metric when its value
// changes; without it the cards snap from one value to the next
// every time the user picks a new build, which reads as a hard
// reset rather than a smooth recomputation.
//
//   tweenNumber(node, {
//       from: 90_368,
//       to:   90_691,
//       duration: 280,
//       format: (n) => formatNumber(Math.round(n)),
//   })
//
// The node's textContent is rewritten on every frame. The tween
// is idempotent per node: a fresh call cancels any in-flight
// animation on the same node so successive rapid build changes
// (the user holding ArrowDown through the build picker) never
// race two animations against each other on the same text.
//
// Honours prefers-reduced-motion by snapping straight to ``to``.
// The CSS-side override in tokens.css already neutralises CSS
// transitions; this guards the JS-driven counterpart so a
// reduced-motion user gets the same "instant" semantic.

const activeTimers = new WeakMap();

const prefersReducedMotion =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;

export function tweenNumber(node, { from, to, duration = 280, format }) {
    if (!node || typeof format !== "function") return;
    // Cancel a previously-scheduled tween on this node before we
    // start a new one. Without this, holding the arrow keys
    // through the build picker can stack two or three rAF loops
    // mutating the same textContent and the number stutters.
    cancelTween(node);

    if (
        from === to ||
        !Number.isFinite(from) ||
        !Number.isFinite(to) ||
        (prefersReducedMotion && prefersReducedMotion.matches)
    ) {
        node.textContent = format(to);
        return;
    }

    const start = performance.now();
    let rafId = 0;

    function step(now) {
        const t = Math.min(1, (now - start) / duration);
        // easeOutCubic feels right for headline counters: most of
        // the motion lands in the first ~70 % of the duration so
        // the eye reads the final value almost immediately while
        // the tail still conveys "this changed".
        const eased = 1 - (1 - t) ** 3;
        const value = from + (to - from) * eased;
        node.textContent = format(value);
        if (t < 1) {
            rafId = requestAnimationFrame(step);
            activeTimers.set(node, rafId);
        } else {
            activeTimers.delete(node);
        }
    }

    rafId = requestAnimationFrame(step);
    activeTimers.set(node, rafId);
}

export function cancelTween(node) {
    const id = activeTimers.get(node);
    if (id) {
        cancelAnimationFrame(id);
        activeTimers.delete(node);
    }
}
