# EventFlow Email Templates

> **Last updated:** June 2026 — see `email-templates/` directory for the live files.

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
| `notification.html`                     | Generic transactional notification     | `utils/postmark.js` (sendNotificationEmail)            | `{{name}}`, `{{title}}`, `{{message}}`, `{{actionUrl}}` (optional), `{{actionText}}` (optional)                                                                        |
| `marketing.html`                        | Admin marketing campaigns              | `routes/admin-campaigns.js`                            | `{{name}}`, `{{title}}`, `{{message}}`, `{{unsubscribeLink}}`                                                                                                          |
| `action-prompts.html`                   | Supplier action reminder emails        | `routes/admin.js`, `services/actionPromptScheduler.js` | `{{actionsHtml}}`, `{{name}}`, `{{unsubscribeSection}}`                                                                                                                |
| `newsletter-confirm.html`               | Newsletter double opt-in               | `routes/newsletter.js`                                 | `{{name}}`, `{{confirmLink}}`                                                                                                                                          |
| `newsletter-welcome.html`               | Newsletter welcome                     | `routes/newsletter.js`                                 | `{{name}}`                                                                                                                                                             |
| `partner-welcome.html`                  | Partner programme welcome              | `routes/partner.js`                                    | `{{name}}`, `{{refCode}}`, `{{refLink}}`, `{{dashboardLink}}`                                                                                                          |
| `supplier-verification-status.html`     | Supplier approval/rejection/suspension | `routes/supplier-admin.js`                             | `{{name}}`, `{{statusTitle}}`, `{{statusMessage}}`, `{{notesSection}}`, `{{dashboardUrl}}`, `{{supportEmail}}`, `{{headerGradient}}`, `{{ctaGradient}}`, `{{ctaText}}` |
| `subscription-activated.html`           | Subscription started                   | `webhooks/stripeWebhookHandler.js`                     | `{{name}}`, `{{planName}}`, `{{dashboardUrl}}`                                                                                                                         |
| `subscription-cancelled.html`           | Subscription cancelled                 | `webhooks/stripeWebhookHandler.js`                     | `{{name}}`, `{{dashboardUrl}}`                                                                                                                                         |
| `subscription-upgraded.html`            | Plan upgraded                          | `webhooks/stripeWebhookHandler.js`                     | `{{name}}`, `{{planName}}`, `{{dashboardUrl}}`                                                                                                                         |
| `subscription-downgrade-scheduled.html` | Downgrade scheduled                    | `webhooks/stripeWebhookHandler.js`                     | `{{name}}`, `{{planName}}`, `{{effectiveDate}}`                                                                                                                        |
| `subscription-payment-failed.html`      | Payment failure                        | `webhooks/stripeWebhookHandler.js`                     | `{{name}}`, `{{retryDate}}`, `{{billingUrl}}`                                                                                                                          |
| `subscription-renewal-reminder.html`    | Renewal reminder                       | `webhooks/stripeWebhookHandler.js`                     | `{{name}}`, `{{renewalDate}}`, `{{dashboardUrl}}`                                                                                                                      |
| `subscription-trial-ending.html`        | Trial ending soon                      | `webhooks/stripeWebhookHandler.js`                     | `{{name}}`, `{{trialEndDate}}`, `{{dashboardUrl}}`                                                                                                                     |

---

## How the loader works

Templates are loaded by `loadEmailTemplate(templateName, data)` in `utils/postmark.js`:

1. Reads `email-templates/<name>.html` from disk.
2. Replaces `{{variableName}}` tokens with values from the `data` object.
3. **HTML-escapes** all values by default (prevents XSS from user input).
4. **Allows raw HTML** for a specific set of keys: `message`, `html`, `features`, `actionsHtml`, `unsubscribeSection`, `notesSection`, `ctaSection`.
   - `ctaSection`: CTA button block for notification emails — built by `sendNotificationEmail()` only when `actionUrl` and `actionText` are both provided, preventing empty `href=""` anchors.
5. Appends `{{year}}` → current year, `{{baseUrl}}` → `APP_BASE_URL` env var.
6. Clears any remaining unresolved `{{...}}` tokens so placeholders never appear in sent emails.

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
