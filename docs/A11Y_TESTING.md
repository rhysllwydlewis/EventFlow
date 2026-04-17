# Accessibility Testing (Part B6)

This repository runs **axe-core** (via `@axe-core/playwright`) against
the same baseline pages covered by the visual regression suite
(`tests/visual/visual-regression.spec.js`). Violations of **WCAG 2.1 AA**
fail the build, except for rules explicitly on the allowlist in
`tests/a11y/axe-ignore.json`.

## Running locally

```bash
# One-off install of Chromium
npx playwright install --with-deps chromium

# Run only the axe-core tests
npm run test:a11y

# Or run the whole visual + a11y suite
npm run test:visual
```

Failures print the full violation list (rule ID, impact, node count) as
the assertion message so you can reproduce the problem directly in the
browser DevTools.

## Adding a justified exception

Edit `tests/a11y/axe-ignore.json`:

```json
{
  "rules": ["color-contrast", "landmark-one-main", "my-new-rule-id"],
  "notes": {
    "my-new-rule-id": "Why this rule cannot be fixed right now. Tracked in issue #NNN."
  }
}
```

Every entry in the `rules` array **must** have a corresponding entry in
`notes` explaining why it's disabled and linking the tracking issue.
Reviewers will reject allowlist additions without both.

## Updating baselines

There are no snapshots for axe — it runs a live assertion. However, if
you fix an accessibility violation that used to be on the allowlist,
remove it from `rules` and delete the corresponding `notes` entry in the
same PR.

## Soft-fail window (same as visual regression)

During the 2-week observation window following the notification-audit
PR, the `.github/workflows/visual-regression.yml` workflow runs with
`continue-on-error: true`. This applies to both the visual and a11y
tests. After the window, the workflow becomes required and both suites
will block PR merges on failure.

## Why this sits in the Playwright config

Running axe-core in the same runner as the visual suite means:

- Baseline pages are only listed in one place.
- Page-load waits (`networkidle`) are shared.
- Static-mode skips (404 / 500) short-circuit both the visual and the
  a11y assertions identically.
