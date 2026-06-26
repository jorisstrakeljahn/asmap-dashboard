// Barrel re-export so existing importers ("./top-movers-table.js")
// resolve to the split implementation under ./top-movers/. The
// orchestrator + submodules live there:
//
//   top-movers/index.js       - mount() entry point
//   top-movers/state.js       - defaults + persisted flags
//   top-movers/sort.js        - comparator + derived metrics
//   top-movers/filter.js      - substring + direction filter
//   top-movers/pagination.js  - page window + page buttons
//   top-movers/columns.js     - table header + sort affordance
//   top-movers/rows.js        - tbody + direction cell
//   top-movers/controls.js    - toolbar / footer controls

export { mount } from "./top-movers/index.js";
