# Frontend tests

```sh
npm test          # node --test web/tests/*.test.js
```

These cover the **pure logic** of the dashboard's JS - range resolution, the
Top Movers sort/classification, diff lookups, bar geometry, variant selection -
plus a drift guard that the vendored lit-html matches the `package.json` pin.

Deliberately tiny and dependency-free:

- **Runner:** Node's built-in `node:test` + `node:assert`. No Jest, no Vitest,
  no config, nothing to install. It ships with Node and will still run in a
  decade - the same reason lit-html is vendored and the pipeline has no build
  step.
- **No DOM / jsdom.** We only test functions that need no `document`, so the
  modules import straight into Node. Rendering itself is verified by code
  review and in the browser; the brittle, high-value math lives here.

Adding a test: drop a `*.test.js` file in this folder, import the function
under test from `../assets/js/...`, and assert. If a function needs `document`
to run, it belongs in review, not here - keep this suite pure.
