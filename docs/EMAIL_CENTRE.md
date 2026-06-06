# Admin Email Centre

The Admin Email Centre is the single visible admin entry point for email operations. It lives at `/admin-emails` and consolidates sent email activity, campaign tools, template previews and email/Postmark health into one admin area.

## Information architecture

Visible admin navigation should show one email-related item only:

- **Email Centre** (`/admin-emails`)

The existing secondary tools remain available and are linked from Email Centre:

- **Campaigns** (`/admin-campaigns`) — compose, test and send marketing/newsletter emails to opted-in recipients.
- **Templates** (`/admin-email-previews`) — review local templates and send sample-data test emails.

## Email logging

All calls through `utils/postmark.js` `sendMail()` are logged centrally. Individual routes do not need to create email logs.

Email activity is stored in the `email_logs` collection using `dbUnified`, so it follows the existing MongoDB-first/local fallback behaviour.

### Stored metadata

Email logs store operational metadata only, including:

- recipients and sender address
- subject
- template name
- safe template data summary
- message stream and tags
- provider (`postmark` or `outbox`)
- status and timestamps
- Postmark `MessageID` when available
- delivery/open/click/bounce event timeline
- safe failure messages

### Deliberately not stored

Email logs deliberately avoid storing:

- full HTML email bodies
- full text email bodies
- password reset links
- verification links
- unsubscribe token values
- raw arbitrary `templateData`
- Postmark API keys or webhook credentials

## Postmark webhook configuration

EventFlow accepts Postmark webhooks at:

- `POST /api/webhooks/postmark`
- `POST /api/v1/webhooks/postmark`

Protect the webhook with Basic Auth. Configure these environment variables and use the same credentials in Postmark webhook settings:

```env
POSTMARK_WEBHOOK_USER=postmark-webhook
POSTMARK_WEBHOOK_PASS=generate-strong-random-password-here
POSTMARK_WEBHOOK_ENABLED=true
```

Recommended Postmark events to enable:

- Delivered
- Opened
- LinkClicked
- Bounced
- SpamComplaint
- SubscriptionChanged

Webhook events are matched to email logs by Postmark `MessageID`. Unknown `MessageID` events return success to avoid retry storms, but they do not update a log.

## Health tab

The Email Centre Health tab shows safe configuration details only:

- whether email is enabled
- whether Postmark is configured
- current provider (`postmark`, `outbox` or `disabled`)
- default sender and email domain
- campaign message stream
- last webhook event timestamp

Secrets such as `POSTMARK_API_KEY`, webhook passwords, JWT secrets and unsubscribe secrets are never returned to the browser.

## Troubleshooting

### Postmark not configured

If Postmark is not configured, `sendMail()` saves messages to the local `outbox` folder and logs them with provider `outbox` so they are still visible in Email Centre.

### Webhook events are not updating logs

Check that:

1. Postmark is sending to `/api/webhooks/postmark` or `/api/v1/webhooks/postmark`.
2. Basic Auth credentials match `POSTMARK_WEBHOOK_USER` and `POSTMARK_WEBHOOK_PASS`.
3. The original send was logged with a Postmark `MessageID`.
4. The event type is enabled in Postmark.

### Missing MessageID

Outbox fallback sends use a generated `outbox-*` ID. Postmark webhook events only update records with real Postmark `MessageID` values.

### Email saved to outbox in development

This is expected when `POSTMARK_API_KEY` is missing or Postmark is disabled. Use the Email Centre Activity tab or the `outbox` folder to inspect local sends.
