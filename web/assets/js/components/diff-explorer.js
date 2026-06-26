// Barrel re-export so existing importers ("./diff-explorer.js")
// resolve to the split implementation under ./diff-explorer/.
// The orchestrator + submodules live there:
//
//   diff-explorer/index.js      - mount() entry point
//   diff-explorer/permalink.js  - sharable URL hash (read + write)
//   diff-explorer/selectors.js  - Map A / Map B selector pair
//   diff-explorer/breakdown.js  - match banner + buckets + bar
//   diff-explorer/results.js    - assembled diff results card

export { mount } from "./diff-explorer/index.js";
