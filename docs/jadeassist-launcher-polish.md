# JadeAssist launcher polish

This follow-up closes the production and visual acceptance gaps left by PR #1394.

## Approved behaviour

- The grey close bubble is visually mirrored opposite the notification bubble.
- Both corner controls move on the same animation timeline as the Jade launcher.
- The close asset remains visually compact while the transparent interaction area is 52 CSS pixels, preserving at least a 44-pixel target after EventFlow's `0.85` widget scale.
- The close control uses the accessible name `Close JadeAssist assistant`.
- A failed notification image falls back to a visible red notification circle rather than an uncontained number.
- Launcher dismissal defaults to 24 hours and can be overridden with `window.JADEASSIST_CONFIG.launcherDismissDurationMs`.
- Reduced-motion users receive a stationary launcher and controls.

## Production delivery

`version-jadeassist-assets.mjs` inserts the launcher polish layer between the vendored widget and the EventFlow initializer, then versions all three script URLs with the same release token. This preserves execution order and prevents a cached pre-fix widget from being reused.

## Verification

`tests/visual/jadeassist-launcher-polish.spec.mjs` serves a test-only virtual harness through Playwright, so no test page or harness script is shipped in `public/`. Both desktop and mobile Chromium cover mirrored geometry, the effective touch target, synchronized animation, accessible naming, image fallback and expiry of configured dismissal state.
