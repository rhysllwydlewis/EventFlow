# Dashboard Navigation Error Toast – Comprehensive Fix Plan

## Problem statement

When a logged-in user is on the homepage and taps/clicks **Dashboard** (top navbar or bottom navbar), an error toast appears (`Something went wrong. Please refresh the page or contact support.`), but navigation to dashboard still succeeds.

## Goals

1. Remove false-positive error toast during valid dashboard navigation.
2. Keep role-aware routing (customer vs supplier/admin dashboard).
3. Ensure the same navigation behavior across top, mobile, and bottom navbar variants.
4. Keep graceful fallback behavior for genuinely broken auth/session states.
5. Prevent regressions across all pages reusing shared navbar scripts.

## Scope and architecture approach

This should be addressed as a **shared navigation and error-boundary contract fix**, not a one-off per-page patch.

### In scope

- Shared navbar click handling and dashboard link resolution logic.
- Global error handler suppression rules for intentional page transitions.
- Auth/session read logic used by dashboard link routing.
- Cross-page instrumentation and test coverage for navigation-to-dashboard journey.

### Out of scope

- Dashboard UI redesign.
- New auth provider migration.
- Unrelated toast styling changes.

## Likely root-cause hypotheses to validate

1. **Race between async auth/profile fetch and navigation redirect**:
   - Click triggers async “resolve dashboard target” call.
   - Route transition starts before fetch resolves/rejects.
   - Late rejection bubbles to global error handler and displays toast despite successful navigation.
2. **Unhandled promise in click handler**:
   - Handler launches async function without awaited catch boundary.
3. **Abort/Cancel treated as failure**:
   - Navigation unload aborts in-flight fetch; abort error is reported as a generic failure.
4. **Duplicate listeners**:
   - Top and bottom dashboard links may both bind listeners that fire/compete on shared state.

## Detailed implementation plan

### Phase 1 — Reproduce and observe (instrumentation-first)

1. Add temporary debug instrumentation around:
   - Dashboard link click source (`top`, `mobile`, `bottom`).
   - Auth/session lookup start/end.
   - Route target decision.
   - Any thrown/returned errors.
2. Capture stack traces reaching global error toast dispatcher for this interaction.
3. Verify whether errors are `AbortError`, network failures, null auth state, or parsing errors.
4. Reproduce on mobile viewport and desktop viewport.

### Phase 2 — Refactor dashboard navigation into a single controller

1. Create a dedicated `navigateToDashboard({ source })` helper used by all dashboard link entry points.
2. Contract for helper:
   - Prevent default link behavior immediately.
   - Resolve target from cached auth state first.
   - Fallback to lightweight session probe if cache missing.
   - Perform a single controlled redirect.
   - Return a structured result object (`ok`, `target`, `reason`).
3. Ensure each UI entry point delegates to this helper (no duplicate logic per link).
4. Guard against duplicate click invocations (idempotency lock for one tick).

### Phase 3 — Error-classification and toast policy

1. Introduce error classes/categories:
   - `NAV_INTENTIONAL_UNLOAD` (expected/no toast)
   - `AUTH_STATE_UNAVAILABLE` (optional gentle prompt)
   - `NETWORK_TRANSIENT`
   - `UNKNOWN`
2. In global error pipeline:
   - Suppress toast for intentional unload/abort categories during active navigation transitions.
   - Preserve logging for diagnostics (console + telemetry).
3. In navbar flow:
   - Only show user-facing toast if navigation target cannot be determined and no redirect occurs.
   - Use clearer copy (e.g., “We couldn’t open your dashboard right now. Please try again.”).

### Phase 4 — Hardening shared navbar integration across pages

1. Audit all pages using shared IDs (`ef-dashboard-link`, `ef-mobile-dashboard`, `ef-bottom-dashboard`).
2. Ensure listener attachment is defensive:
   - Attach only when element exists.
   - Mark element/listener registration to avoid double binding.
3. Normalize href behavior:
   - Keep `href="#"` only if JS always intercepts.
   - Consider progressive fallback href to `/dashboard` where safe.
4. Ensure role/plan-specific dashboard routes are centralized (single route map module).

### Phase 5 — Test strategy (big-PR quality gate)

1. **Unit tests** for `navigateToDashboard`:
   - Cached auth success.
   - Session probe success.
   - Probe timeout/network fail.
   - Abort during unload.
2. **Integration tests** for navbar controller:
   - Top navbar click.
   - Bottom navbar click.
   - No duplicate redirect/no duplicate toast.
3. **E2E tests** (Playwright):
   - Logged-in customer on homepage → dashboard click → no error toast → dashboard loaded.
   - Logged-in supplier/admin variant.
   - Mobile viewport regression case matching reported device class.
4. Add assertions that no global error toast appears during successful dashboard navigation.

### Phase 6 — Observability and rollout

1. Add telemetry event `dashboard_nav_attempt` with fields:
   - `source`, `resolved_target`, `success`, `error_category`.
2. Add `dashboard_nav_false_error_toast` counter for post-deploy monitoring.
3. Roll out behind a small feature flag if desired, then ramp to 100% after error-rate check.

## Suggested file-level touchpoints (initial)

- `public/assets/js/navbar.js`
- `public/assets/js/utils/global-error-handler.js`
- `public/assets/js/utils/auth-helpers.js`
- `public/assets/js/components/error-boundary.js` (if boundary interception involved)
- Playwright tests under existing e2e location

## Acceptance criteria

1. Clicking dashboard from homepage (top/mobile/bottom nav) **never** shows false error toast when redirect succeeds.
2. Dashboard destination remains correct for each role.
3. Genuine failures still provide meaningful feedback and are logged.
4. Automated tests cover the regression path and pass in CI.

## PR shape recommendation (large, complete)

- **PR 1 (this bug + foundations):** shared navigation controller, error classification, navbar integration, tests.
- **PR 2 (optional follow-up):** broader nav consistency cleanup across secondary pages and stale link patterns.

This plan intentionally favors a robust, platform-level fix over a tactical suppression-only patch.
