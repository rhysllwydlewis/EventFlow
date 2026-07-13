# EventFlow Behaviour Analytics

EventFlow includes a privacy-first, first-party behaviour analytics layer and an optional PostHog integration. The first-party dashboard is available at **Admin → Analytics** and works without a paid analytics provider.

## What is measured

Only visitors who actively consent to **Analytics Cookies** are included. The collector validates consent in the browser and again on the server before accepting events.

The browser records:

- page views and anonymous sessions
- active engagement time while the tab is both visible and focused
- scroll-depth milestones
- broad device category and referring domain
- supplier and package journey events
- add-to-plan, shortlist, enquiry and successful conversion signals
- browser errors and supported performance metrics

The system deliberately does **not** store raw IP addresses, raw user-agent strings, form values, message content, email addresses or URL query strings. Browser session IDs and signed-in user IDs are one-way hashed before first-party storage. Admin browsing and private account-management pages are excluded from public behaviour collection.

## Admin dashboard

Open `/admin-analytics` and use the **Visitor Behaviour & Engagement** section.

The dashboard provides:

- page views and measured sessions
- average active time per session
- engaged-session rate
- conversions and browser errors
- page-level active time, exits and bounces
- the marketplace journey from search through enquiry or conversion
- referrer and device breakdowns
- automated improvement signals, including journey drop-offs

Choose 7, 30 or 90 days from the period selector. Revenue and user-growth analytics remain on the same page below the behaviour section.

The Admin Analytics page refreshes automatically every 15 seconds while its browser tab is visible. It pauses when the tab is hidden and refreshes immediately when the administrator returns. The manual refresh button remains available.

## Railway environment variables

The first-party collector is enabled by default. These variables can be added in Railway when different behaviour is required:

```env
BEHAVIOUR_ANALYTICS_ENABLED=true
ANALYTICS_HEARTBEAT_SECONDS=15
ANALYTICS_RETENTION_DAYS=90
ANALYTICS_RATE_LIMIT_MAX=600
ANALYTICS_HASH_SALT=replace-with-a-long-random-value
```

`ANALYTICS_HASH_SALT` should be a separate random secret. When absent, the application falls back to `JWT_SECRET` for one-way identifier hashing.

## Optional PostHog setup

PostHog is optional. EventFlow's first-party Admin Analytics dashboard continues to work without it.

1. Create or open a PostHog project.
2. Copy the public project key from the project's settings.
3. While inside that PostHog project, copy the project or dashboard URL from the browser address bar. It must contain `/project/`, not merely `https://eu.posthog.com` or `https://us.posthog.com`.
4. Add the matching variables in Railway:

```env
POSTHOG_PROJECT_KEY=phc_your_public_project_key
POSTHOG_API_HOST=https://eu.i.posthog.com
POSTHOG_UI_HOST=https://eu.posthog.com
POSTHOG_DASHBOARD_URL=https://eu.posthog.com/project/YOUR_PROJECT_ID
POSTHOG_SESSION_RECORDING_ENABLED=false
```

For a US PostHog project, use the equivalent US hosts and the exact US project URL.

The project key is intended for browser use and is not a secret. Do not add a PostHog personal API key to client configuration.

`POSTHOG_DASHBOARD_URL` controls the **Open PostHog** button in Admin Analytics. If it is missing or contains only the general PostHog homepage, EventFlow hides the misleading button and shows a configuration message instead. After changing Railway variables, redeploy the application.

PostHog capture remains anonymous: EventFlow does not send its internal user IDs to PostHog, person profiles are disabled, autocapture is disabled and only explicitly generated analytics events are sent.

After deployment, accept Analytics Cookies on EventFlow, browse several public pages, and confirm events appear in the selected PostHog project. The Admin Analytics page shows **Open PostHog** only when it has a specific project destination.

## Session recordings

Recordings are disabled by default. Set `POSTHOG_SESSION_RECORDING_ENABLED=true` only after reviewing the privacy controls and documentation.

When enabled:

- all input fields are masked
- designated sensitive text is masked
- URL query strings are removed before capture
- the PostHog SDK is not loaded on admin, authentication, payment, messaging, dashboard, settings, plan, guest-management or private supplier-management pages
- elements marked `.ph-no-capture` or `[data-analytics-sensitive]` are excluded from interaction tracking

## Understanding active time

Active time is more useful than simply subtracting arrival time from departure time. EventFlow pauses its timer when the page is hidden, the browser is minimised or the tab loses focus. A user leaving a tab open while away from the computer therefore does not inflate the figure indefinitely.

It still cannot prove that somebody read every word. Treat active time alongside scroll depth, next-page actions, exits and conversions rather than as a standalone success measure.

## Retention and withdrawal

First-party events are retained for the configured number of days and old events are removed automatically. If a visitor withdraws analytics consent, EventFlow stops collecting, clears the browser analytics session identifier and opts the browser out of PostHog capture.

Existing aggregate analytics are not automatically deleted when a browser withdraws consent because the stored identifiers are one-way hashes and cannot be reliably mapped back to that browser. Data-subject requests involving an authenticated account should follow EventFlow's established privacy-request process.
