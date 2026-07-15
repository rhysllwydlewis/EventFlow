# Admin Analytics Decision Dashboard

Date: 14 July 2026

## Purpose

This change follows a sense-check of the existing Admin Analytics page. The page already had strong consented behaviour measurement, but several figures could be interpreted too broadly and the dashboard did not compare the selected period with the immediately preceding period.

The implementation keeps the existing privacy model and adds a decision-focused layer using the same sanitised first-party events.

## Confirmed changes

### Revenue wording

The Stripe endpoint returns the latest charge sample rather than a guaranteed complete lifetime ledger. The card formerly labelled **Total Revenue (All Time)** is therefore relabelled **Stripe Revenue (Latest Charges)** and explicitly states that it covers the latest 100 returned charges.

This prevents a sampled figure from being presented as complete all-time revenue.

### Real previous-period comparison

The behaviour summary endpoint now accepts `offsetDays` in addition to the existing 7, 30 and 90-day reporting periods.

For example:

- current 30 days: `?days=30`
- preceding 30 days: `?days=30&offsetDays=30`

The query is bounded by both a start and end timestamp. Current events cannot leak into the previous-period result.

The Admin Analytics page compares:

- sessions;
- page views;
- average active time;
- engaged-session rate;
- unique converting sessions; and
- browser errors.

A previous-period comparison is shown only when both the configured retention period and the earliest stored event demonstrate that the full current and preceding windows are available. For example, comparing the latest 90 days with the preceding 90 days requires at least 180 days of retention and stored history reaching the beginning of the preceding window. Current-period figures remain available when the comparison window is incomplete.

### Conversion definitions

The existing conversion KPI counts completed analytics actions. It does not represent unique customers or unique purchases.

The new decision dashboard separates:

- total completed conversion actions;
- unique browser sessions that completed at least one conversion action;
- conversion-session rate; and
- action counts by conversion type.

Registrations are labelled generically because the privacy-safe response observer does not inspect submitted registration form values to infer whether the new account is a customer or supplier.

### Homepage performance

The dashboard groups analytics for:

- the live root homepage path;
- Homepage 1 preview paths;
- Homepage 2 preview paths; and
- Homepage 3 preview paths.

Preview paths can be attributed precisely. Historical root-path traffic cannot be retrospectively assigned after the active homepage version changes, so the dashboard labels it **Live homepage** and separately shows which version is currently active.

### Marketplace signals

Where existing sanitised events contain a supplier or package ID, the dashboard aggregates:

- views;
- measured sessions;
- saves or add-to-plan actions;
- completed enquiries or quote requests; and
- the percentage of measured entity sessions that submitted at least one enquiry or quote request.

Opening an enquiry form does not count as a completed lead. Repeated page views and repeated submissions within the same session do not inflate the session-rate numerator. Public supplier and package pages now attach only their known public entity identifier to the existing sanitised view event. Result clicks, saves and enquiry starts also carry the nearest known public entity identifier. Query strings themselves remain excluded. Rows are omitted rather than inferred when an event did not contain an entity ID.

### Export

The selected current period can be exported as CSV. The export includes headline totals, conversion types, homepage-path performance and available supplier/package signals. Cells beginning with spreadsheet formula characters are prefixed safely before download to prevent formula execution when an administrator opens the file.

## Performance and storage

The summary endpoint now caches each current or comparison window for 15 seconds, matching the visible page refresh cadence. The cache is cleared when new events are accepted or retention cleanup removes events.

A compound timestamp/event index is added alongside the existing timestamp index to support bounded reporting windows.

## Privacy unchanged

This change does not introduce persistent visitor identity, cross-session tracking, raw IP storage, raw user-agent storage, query-string storage, form-value capture or analytics without consent.

Admin traffic and private account-management pages remain excluded.

## Deliberately excluded from this PR

The following ideas were not implemented because the present data cannot support them accurately or they require a separate product/privacy decision:

- claiming a consent-coverage percentage without a comparable total-traffic source;
- calling sessions unique visitors;
- cross-session new-versus-returning visitor tracking;
- customer or supplier cohort retention;
- exact historical V1/V2/V3 attribution for visits made to `/` before or after a homepage switch;
- lifetime value, net Stripe revenue and Stripe fee/refund reporting without a complete paginated financial ledger;
- supplier onboarding funnels across private pages that are intentionally excluded from behaviour collection.

## Validation checklist

1. Open `/admin-analytics` and confirm the existing behaviour section still loads.
2. Confirm the Decision Dashboard appears immediately below it.
3. Change the range between 7, 30 and 90 days and confirm current and complete previous-period figures update.
4. Confirm an unavailable comparison is clearly labelled when retention does not contain both full windows.
5. Confirm the Stripe revenue card no longer says all-time.
6. Confirm conversion action totals and converting sessions are shown separately.
7. Confirm the active homepage version is shown, while live root traffic remains labelled honestly.
8. Confirm marketplace starts do not count as completed enquiries and rates remain bounded by measured sessions.
9. Export CSV and verify that the file contains totals, conversions, homepage rows and any available entity rows.
10. Confirm Analytics Cookies withdrawal still stops collection and no new identity mechanism is created.
