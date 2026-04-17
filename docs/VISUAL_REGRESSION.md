# Visual Regression (Part B4)

This repository has a Playwright-based visual regression suite under
`tests/visual/`. It runs against the **static preview server**
(`scripts/serve-static.js`) so snapshots are deterministic and do not
depend on a live database.

## Running locally

```bash
# One-off install of Chromium
npx playwright install --with-deps chromium

# Run the suite
npm run test:visual

# Update baselines after an intentional visual change
npm run test:visual:update
```

The HTML report is written to `visual-report/` and screenshot diffs to
`tests/visual/__screenshots__/`.

## Interpreting diffs

- Green/red pixel deltas above the configured `maxDiffPixelRatio: 0.02`
  will fail the test. 2% is tight enough to catch most real regressions
  but loose enough to survive antialiasing / font-hinting changes between
  Chromium patch releases.
- If a diff is intentional (e.g. a deliberate restyle), update baselines
  in the same PR with `npm run test:visual:update` and include the new
  screenshots in your commit.
- If a diff is suspicious, download the `visual-diffs` artefact from the
  workflow run and inspect the `*-diff.png` files side-by-side.

## Soft-fail policy

The `.github/workflows/visual-regression.yml` workflow runs with
`continue-on-error: true` for a 2-week observation window following the
notification-audit PR. During that window:

- Failures **do not block** PR merges.
- The report + diffs are still uploaded as CI artefacts so reviewers can
  assess whether the drift is intentional.
- Add the label `visual-regression-soft` to any PR that intentionally
  drifts the baselines, so the next follow-up PR can flip the workflow
  to hard-fail.

After the window expires, remove `continue-on-error` from the workflow
so failures become required.

## Adding a new baseline page

Edit `tests/visual/visual-regression.spec.js`:

```js
const BASELINE_PAGES = [
  // ... existing pages
  { name: 'my-new-page', path: '/my-new-page' },
];
```

Then run `npm run test:visual:update` to generate the initial baseline
and commit the new `__screenshots__/...my-new-page-*.png` files.

## Mobile coverage

Mobile baselines are generated via the `mobile-chromium` Playwright
project, which uses the `Pixel 5` device profile. The same test file is
run twice — desktop + mobile — with snapshot filenames suffixed by the
project name.
