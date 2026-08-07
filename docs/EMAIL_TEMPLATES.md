# EventFlow Email Templates

> **Last updated:** August 2026 — see `email-templates/` directory for the live files.

EventFlow uses local HTML templates rendered server-side and delivered via Postmark.
No Postmark-hosted templates are used — all templates live in `email-templates/`.

---

## Template inventory

| Template file                           | Purpose                                | Used by                                                | Key variables                                                                                                                                                          |
| --------------------------------------- | -------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verification.html`                     | Account email verification             | `routes/emailVerification.js`, `utils/postmark.js`     | `{{name}}`, `{{verificationLink}}`                                                                                                                                     |
| `welcome.html`                          | Generic welcome (legacy fallback)      | `services/email.service.js`                            | `{{name}}`                                                                                                                                                             |
| `welcome-customer.html`                 | Customer onboarding                    | `utils/postmark.js` (sendWelcomeEmail)                 | `{{name}}`                                                                                                                                                             |
| `welcome-supplier.html`                 | Supplier onboarding                    | `utils/postmark.js` (sendWelcomeEmail)                 | `{{name}}`                                                                                                                                                             |
| `password-reset.html`                   | Password reset link                    | `utils/postmark.js`, `routes/auth.js`                  | `{{name}}`, `{{resetLink}}`                                                                                                                                            |
| `password-reset-confirmation.html`      | Password changed confirmation          | `utils/postmark.js`                                    | `{{name}}`, `{{resetTime}}`                                                                                                                                            |
| `notification.html`                     | Generic transactional notification     | `utils/postmark.js` (sendNotificationEmail)            | `{{name}}`, `{{title}}`, `{{message}}`, `{{ctaSection}}` (optional — built server-side; pass `actionUrl` + `actionText` to `sendNotificationEmail()` options)          |
| `marketing.html`                        | Admin marketing campaigns              | `routes/admin-campaigns.js`                            | `{{name}}`, `{{title}}`, `{{message}}`, `{{unsubscribeLink}}`                                                                                                          |
| `action-prompts.html`                   | Supplier action reminder emails        | `routes/admin.js`, `services/actionPromptScheduler.js` | `{{actionsHtml}}`, `{{name}}`, `{{unsubscribeSection}}`                                                                                                                |
| `newsletter-confirm.html`               | Newsletter double opt-in               | `routes/newsletter.js`                                 | `{{confirmLink}}`                                                                                                                                                      |
| `newsletter-welcome.html`               | Newsletter welcome                     | `routes/newsletter.js`                                 | `{{unsubscribeLink}}`                                                                                                                                                  |
| `partner-welcome.html`                  | Partner programme welcome              | `routes/partner.js`                                    | `{{name}}`, `{{refCode}}`, `{{refLink}}`, `{{dashboardLink}}`                                                                                                          |
| `supplier-verification-status.html`     | Supplier approval/rejection/suspension | `routes/supplier-admin.js`                             | `{{name}}`, `{{statusTitle}}`, `{{statusMessage}}`, `{{notesSection}}`, `{{dashboardUrl}}`, `{{supportEmail}}`, `{{headerGradient}}`, `{{ctaGradient}}`, `{{ctaText}}` |
| `support-ticket-reply.html`             | Support ticket reply                   | `routes/tickets.js`, `routes/admin.js`                 | `{{name}}`, `{{ticketSubject}}`, `{{replyMessageHtml}}`, `{{ticketUrl}}`, `{{supportEmail}}`, `{{preheader}}`                                                          |
| `contact-enquiry-reply.html`            | Contact form enquiry reply             | `routes/admin.js`                                      | `{{name}}`, `{{enquirySubject}}`, `{{replyMessageHtml}}`, `{{supportEmail}}`                                                                                           |
| `review-request.html`                   | Customer review request                | `routes/review-requests.js`                            | `{{name}}`, `{{supplierName}}`, `{{reviewLink}}`, `{{expiresInDays}}`                                                                                                  |
| `new-message.html`                      | Real-time messenger notification       | `services/queue/workers/email.worker.js`               | `{{senderName}}`, `{{contextSuffix}}`, `{{previewHtml}}`, `{{conversationUrl}}`                                                                                        |
| `subscription-activated.html`           | Subscription started                   | `webhooks/stripeWebhookHandler.js`                     | `{{name}}`, `{{planName}}`, `{{status}}`, `{{trialRow}}`, `{{renewalDate}}`, `{{amount}}`, `{{billingCycle}}`, `{{features}}`                                          |
| `subscription-cancelled.html`           | Subscription cancelled                 | `webhooks/stripeWebhookHandler.js`                     | `{{name}}`, `{{planName}}`, `{{endDate}}`                                                                                                                              |
| `subscription-upgraded.html`            | Plan upgraded                          | `services/subscriptionService.js`                      | `{{name}}`, `{{previousPlan}}`, `{{newPlan}}`, `{{effectiveDate}}`, `{{amount}}`, `{{billingCycle}}`, `{{features}}`                                                   |
| `subscription-downgrade-scheduled.html` | Downgrade scheduled                    | `services/subscriptionService.js`                      | `{{name}}`, `{{currentPlan}}`, `{{newPlan}}`, `{{currentAmount}}`, `{{newAmount}}`, `{{billingCycle}}`, `{{effectiveDate}}`                                            |
| `subscription-payment-failed.html`      | Payment failure                        | `webhooks/stripeWebhookHandler.js`                     | `{{name}}`, `{{planName}}`, `{{amount}}`, `{{attemptDate}}`, `{{gracePeriodEnd}}`                                                                                      |
| `subscription-renewal-reminder.html`    | Renewal reminder                       | `webhooks/stripeWebhookHandler.js`                     | `{{name}}`, `{{planName}}`, `{{daysUntilRenewal}}`, `{{renewalDate}}`, `{{amount}}`, `{{autoRenew}}`, `{{renewalMessage}}`, `{{ctaText}}`                              |
| `subscription-trial-ending.html`        | Trial ending soon                      | `webhooks/stripeWebhookHandler.js`                     | `{{name}}`, `{{planName}}`, `{{trialDays}}`, `{{daysLeft}}`, `{{trialEndDate}}`, `{{amount}}`, `{{billingCycle}}`                                                      |

**Note:** `{{amount}}` and its variants (`currentAmount`, `newAmount`) are always bare number strings (e.g. `"29.00"`) — every billing template's own markup prepends the `£` symbol. Never pass a pre-formatted `"£29.00"` string.

---

## Campaign-safe templates

Only a restricted set of templates can be used for admin campaigns (via `/admin-campaigns`). This prevents accidental use of transactional templates (verification, password reset, etc.) in mass-sends.

Currently campaign-safe: `marketing`, `notification`

The allowlist is enforced in `routes/admin-campaigns.js` via `CAMPAIGN_SAFE_TEMPLATES`. Every campaign API endpoint — preview, test-send and broadcast — rejects any template not in this set with a `400` error.

---

## How the loader works

Templates are loaded by `loadEmailTemplate(templateName, data)` in `utils/postmark.js`:

1. Reads `email-templates/<name>.html` from disk.
2. Replaces `{{variableName}}` tokens with values from the `data` object.
3. **HTML-escapes** all values by default (prevents XSS from user input).
4. **Allows raw HTML** for a specific set of keys: `message`, `html`, `features`, `actionsHtml`, `unsubscribeSection`, `notesSection`, `ctaSection`, `replyMessageHtml`, `trialRow`, `previewHtml`.
   - `ctaSection`: CTA button block for notification emails — built by `sendNotificationEmail()` only when `actionUrl` and `actionText` are both provided, preventing empty `href=""` anchors.
5. Appends `{{year}}` → current year, `{{baseUrl}}` → `APP_BASE_URL` env var.
6. Clears any remaining unresolved `{{...}}` tokens so placeholders never appear in sent emails.

### Raw HTML allowlisted keys — safety warning

The loader HTML-escapes all template variables by default. However, a small set of keys are **allowed to inject raw HTML** unescaped. These must only ever receive backend-constructed markup:

| Key                  | Where it is constructed                                        | Safety note                                                                      |
| -------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `message`            | `admin-campaigns.js` (campaign body) or `sendMarketingEmail()` | Campaign body from admin form; CTA injected with `escapeHtml(ctaText)`           |
| `html`               | Explicit callers only                                          | Must only receive validated HTML                                                 |
| `features`           | Subscription email builders                                    | Always backend-constructed                                                       |
| `actionsHtml`        | `services/actionPromptScheduler.js`                            | Always backend-constructed                                                       |
| `unsubscribeSection` | Action prompt builder                                          | Always backend-constructed                                                       |
| `notesSection`       | `routes/supplier-admin.js`                                     | Admin notes are `escapeHtml()`-escaped before wrapping                           |
| `ctaSection`         | `utils/postmark.js` (sendNotificationEmail)                    | Only constructed when both `actionUrl` (http/https) and `actionText` are present |
| `replyMessageHtml`   | `routes/tickets.js`, `routes/admin.js`                         | Reply text is `escapeHtml()`-escaped and line-break-converted before wrapping    |
| `trialRow`           | `webhooks/stripeWebhookHandler.js`                             | Backend-constructed `<tr>` markup, or empty string when there is no trial        |
| `previewHtml`        | `services/queue/workers/email.worker.js`                       | Message preview is `escapeHtml()`-escaped before wrapping                        |

**Never** pass unescaped user input to any of these keys.

---

### Sending an email

```js
const { sendMail, FROM_HELLO } = require('../utils/postmark');

await sendMail({
  to: 'user@example.com',
  subject: 'Welcome to the Partner Programme',
  template: 'partner-welcome',
  templateData: {
    name: 'Alice',
    refCode: 'EF-ALICE-99',
    refLink: 'https://event-flow.co.uk/auth?ref=EF-ALICE-99',
    dashboardLink: 'https://event-flow.co.uk/partner/dashboard',
  },
  from: FROM_HELLO,
  tags: ['partner-welcome', 'transactional'],
  messageStream: 'outbound',
});
```

### Named sender addresses

| Constant       | Default address            | Use for                           |
| -------------- | -------------------------- | --------------------------------- |
| `FROM_NOREPLY` | `noreply@event-flow.co.uk` | Verification, security emails     |
| `FROM_HELLO`   | `hello@event-flow.co.uk`   | Welcome, partner, supplier status |
| `FROM_SUPPORT` | `support@event-flow.co.uk` | Notifications, tickets            |
| `FROM_INFO`    | `info@event-flow.co.uk`    | Marketing, newsletter             |
| `FROM_BILLING` | `billing@event-flow.co.uk` | Subscription, payment emails      |
| `FROM_ADMIN`   | `admin@event-flow.co.uk`   | System/admin emails               |

---

## Adding a new template

1. Create `email-templates/my-new-template.html` using the existing templates as a reference.
2. Use table-based layout with inline styles — essential for email-client compatibility.
3. Include `{{year}}` in the footer and `{{baseUrl}}` for links.
4. Use `{{name}}` for personalisation where applicable.
5. Keep max-width at 600px.
6. Add a mobile responsive `@media` block in `<style>`.
7. Add the template name to `REFERENCED_TEMPLATES` in `tests/unit/email-templates.test.js`.
8. Send using `sendMail({ template: 'my-new-template', templateData: { ... } })`.

---

## Postmark fallback / outbox

When `POSTMARK_API_KEY` is not set (e.g. in local development), emails are saved to `/outbox/` as `.eml` files for inspection. No email is sent.

---

## Required environment variables

| Variable                     | Required         | Purpose                                                  |
| ---------------------------- | ---------------- | -------------------------------------------------------- |
| `POSTMARK_API_KEY`           | Yes (production) | Postmark Server API key                                  |
| `APP_BASE_URL` or `BASE_URL` | Yes              | Base URL for links in emails                             |
| `EMAIL_DOMAIN`               | No               | Overrides all `@event-flow.co.uk` sender domains at once |
| `POSTMARK_FROM`              | No               | Override default noreply sender                          |
| `POSTMARK_FROM_HELLO`        | No               | Override hello@ sender                                   |
| `POSTMARK_FROM_SUPPORT`      | No               | Override support@ sender                                 |
| `POSTMARK_FROM_INFO`         | No               | Override info@ sender                                    |
| `POSTMARK_FROM_BILLING`      | No               | Override billing@ sender                                 |
| `POSTMARK_FROM_ADMIN`        | No               | Override admin@ sender                                   |
| `UNSUBSCRIBE_SECRET`         | Yes (marketing)  | HMAC secret for unsubscribe link tokens                  |

---

## Postmark message streams

| Stream           | Used for                                                    |
| ---------------- | ----------------------------------------------------------- |
| `outbound`       | Transactional emails (verification, welcome, notifications) |
| `password-reset` | Password reset emails                                       |
| `broadcasts`     | Marketing campaigns, newsletters                            |

---

## Testing

Run the template test suite:

```bash
npx jest tests/unit/email-templates.test.js
```

Tests validate:

- Every code-referenced template file exists on disk
- Every template renders without error via the loader
- Required placeholders exist in each template
- XSS escaping works for user-provided data
- `notesSection` renders as raw HTML (safe, backend-constructed only)
- All templates include `{{year}}`, 600px max-width, `<table>` layout, and `lang="en"`

---

## Permanent admin preview gallery

Admins can review the live local templates at `/admin/email-previews`. The page is protected by the same admin HTML guard and API role checks as other admin tools.

The gallery uses `utils/emailTemplateRegistry.js` as the central source for:

- template inventory metadata, categories and purposes;
- fixed representative sample data;
- default preheader copy;
- curated plain-text fallbacks for important templates.

The preview API is mounted at `/api/admin/email-previews` and renders through `utils/postmark.js` via `loadEmailTemplate()`, so the gallery reflects the same local template pipeline used for production sends. Individual preview test sends are available at `/api/admin/email-previews/:templateName/test-send`; they are admin-only, CSRF-protected, rate-limited, restricted to one validated email address and always use a `[TEST]` subject prefix.

## Preheaders and plain text

`loadEmailTemplate()` now injects a hidden email-client-compatible preheader using the default copy in `utils/emailTemplateRegistry.js` unless a caller supplies `templateData.preheader`. The hidden preheader is inserted after `<body>` and should not have visible layout impact.

`sendMail()` now prefers `renderPlainTextTemplate(template, templateData)` for local template sends when the caller does not provide explicit text. The older HTML-stripping fallback remains for ad-hoc HTML emails.

When adding a new important template:

1. Add metadata, sample data and a preheader in `utils/emailTemplateRegistry.js`.
2. Add a plain-text branch to `renderPlainTextTemplate()` if the email is security, welcome, partner, supplier, marketing/newsletter or billing related.
3. Confirm the text output includes the full CTA URL, support/contact details where relevant, unsubscribe links for marketing/newsletter content and no raw HTML.
4. Add/update unit tests in `tests/unit/email-templates.test.js`.

## Branding decision

No current bitmap wordmark is suitable for universal email-client rendering. `public/bimi.svg` remains useful for BIMI/domain identity, but SVG image support in email bodies is inconsistent, so `loadEmailTemplate()` does not inject it as a remote image. Instead it preserves the compact EF tile and adds a light EventFlow wordmark/tagline treatment that works when images are blocked. Templates should continue to use compact green/teal headers rather than large remote hero images.

## Route/link audit notes

Canonical email CTA routes are:

- customer planning: `/start`, `/plan`, `/suppliers`;
- supplier dashboard: `/dashboard/supplier` (legacy `/dashboard-supplier.html` redirects, but new email links should not use it);
- supplier billing: `/supplier/subscription`;
- partner dashboard: `/partner/dashboard`;
- account/settings: `/settings` and `/settings/notifications`;
- security: `/verify` and `/reset-password`;
- legal/help: `/privacy`, `/terms`, `/contact`.

Avoid linking emails to bare `/profile`, `/inquiries` or `/checklist`; these are not canonical public HTML routes. Prefer the supplier dashboard or customer planning pages above.

## Admin campaign composer guidance

`/admin-campaigns` supports structured fields for intro copy, body copy, feature list, optional banner URL, CTA text/URL and secondary notes. The advanced raw HTML field remains available for admin-only formatting, but it is sanitised server-side with the existing content sanitiser before template rendering.

Campaign safety rules:

- CTA text and CTA URL must be provided together.
- CTA and banner URLs must be `http://` or `https://`.
- Preview, test-send and broadcast use the same `buildTemplateData()` render path.
- Marketing unsubscribe links are injected for preview/test/send and must remain visible in `marketing.html`.
- Always send a test email and review the final confirmation modal before broadcasting.

## Raw HTML allowlist

`utils/postmark.js` exposes `RAW_HTML_TEMPLATE_KEYS` for the small set of placeholders that can intentionally render HTML. Do not add keys unless there is no safer structured alternative.

| Key                  | Constructed by                                      | Safety expectation                                      |
| -------------------- | --------------------------------------------------- | ------------------------------------------------------- |
| `message`            | `routes/admin-campaigns.js`, `sendMarketingEmail()` | Admin campaign HTML is sanitised; CTA text is escaped.  |
| `html`               | Explicit callers only                               | Must already be validated/sanitised by the caller.      |
| `features`           | Subscription builders                               | Backend-controlled markup only.                         |
| `actionsHtml`        | Action prompt services                              | Backend-controlled markup only.                         |
| `unsubscribeSection` | Action prompt and campaign helpers                  | Backend-generated links only.                           |
| `notesSection`       | Supplier verification status builders               | Notes must be escaped before wrapping.                  |
| `ctaSection`         | `sendNotificationEmail()`                           | Backend-generated only when URL and text are present.   |
| `replyMessageHtml`   | Ticket/enquiry reply routes                         | Reply text is escaped and line-break-converted first.   |
| `trialRow`           | `webhooks/stripeWebhookHandler.js`                  | Backend-constructed markup, empty string when no trial. |
| `previewHtml`        | `services/queue/workers/email.worker.js`            | Message preview is escaped before wrapping.             |

## Visual review checklist

Use `/admin/email-previews` before releasing email changes. For screenshot smoke coverage, run the visual test targeting the gallery when a browser environment is available.

### Email release checklist

- [ ] All templates render in `/admin/email-previews`
- [ ] No unresolved `{{...}}` placeholders
- [ ] Key CTAs tested
- [ ] Plain-text fallback checked
- [ ] Preheader checked
- [ ] Gmail test sent
- [ ] Outlook test sent
- [ ] Mobile test sent
- [ ] Marketing unsubscribe link tested
- [ ] Admin campaign preview tested
- [ ] Admin campaign test send completed
- [ ] Payment/billing email tone reviewed
- [ ] Supplier verification note escaping tested
