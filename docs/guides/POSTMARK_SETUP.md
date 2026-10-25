# Postmark Email Configuration Guide

EventFlow uses **Postmark exclusively** for all transactional email delivery. This guide will help you set up and configure Postmark for production use.

## Quick Start

### 1. Create Postmark Account

1. Sign up at [https://postmarkapp.com/](https://postmarkapp.com/)
2. Create a new server (or use the default "My Server")
3. Get your Server API Token from the **API Tokens** tab

### 2. Verify Your Sender Domain

To send emails from `admin@event-flow.co.uk`, you must verify the domain:

1. Go to **Sender Signatures** in Postmark
2. Add your domain: `event-flow.co.uk`
3. Follow the DNS verification steps (add DKIM, SPF, and return-path records)
4. Wait for verification (usually takes a few minutes)

**Note:** In development, you can use a verified single email address instead of a domain.

### 3. Configure Message Streams

EventFlow uses different message streams for different email types:

1. **`outbound`** (default) - Verification emails, notifications, welcome emails
2. **`password-reset`** - Password reset emails
3. **`broadcasts`** - Marketing emails

Configure these in Postmark:

1. Go to **Message Streams** in your server
2. The `outbound` stream exists by default
3. Create a new stream called `password-reset` (Transactional)
4. Create a new stream called `broadcasts` (Broadcast) for marketing emails

### 4. Set Environment Variables

Add these to your `.env` file or deployment platform:

```bash
# Required
POSTMARK_API_KEY=your-server-api-token-here
POSTMARK_FROM=admin@event-flow.co.uk

# Optional
EMAIL_ENABLED=true
APP_BASE_URL=https://event-flow.co.uk
```

### 5. Configure Webhooks (Optional but Recommended)

Webhooks allow you to track email delivery, bounces, and spam complaints:

1. Go to **Webhooks** in your Postmark server
2. Click **Add webhook**
3. Set webhook URL to: `https://event-flow.co.uk/api/webhooks/postmark`
4. Select events to track:
   - ✅ **Delivery** - Track successful deliveries
   - ✅ **Bounce** - Track bounced emails (critical for deliverability)
   - ✅ **Spam Complaint** - Track spam reports (critical for reputation)
   - ⚪ Open - Optional, for analytics
   - ⚪ Click - Optional, for analytics
   - ⚪ Subscription Change - Optional, for unsubscribe tracking

5. **Add basic auth** (REQUIRED for security):
   - Username: `postmark-webhook` (or your choice)
   - Password: Generate a strong random password (e.g., `openssl rand -base64 32`)
   - Add these credentials in Postmark webhook settings
   - Set environment variables:
     ```bash
     POSTMARK_WEBHOOK_USER=postmark-webhook
     POSTMARK_WEBHOOK_PASS=your-generated-password
     ```

6. Test the webhook using Postmark's test feature

**Webhook URL:** `https://event-flow.co.uk/api/webhooks/postmark`

**Security Note:** The webhook endpoint validates basic auth credentials when `POSTMARK_WEBHOOK_USER` and `POSTMARK_WEBHOOK_PASS` are configured. This prevents unauthorized webhook events from being processed.

## Email Templates

EventFlow uses **local HTML templates** stored in `/email-templates/`:

- `verification.html` - Email verification
- `password-reset.html` - Password reset
- `welcome.html` - Welcome email after verification
- `notification.html` - General notifications
- `marketing.html` - Marketing emails

**No Postmark-hosted templates are required.** All templates are rendered locally and sent as HTML emails.

## Testing

### Development Testing

When `POSTMARK_API_KEY` is not configured, a record of each email is saved to the `/outbox` folder as an `.eml` file. By default that record is **metadata only** (masked recipient, sender, template name, time, message id): the subject and body are not stored, because they contain verification links and text users typed. To keep the full email for local debugging, set `EVENTFLOW_OUTBOX_FULL=1` in your local `.env` (it is ignored when `NODE_ENV=production` and in Railway PR previews; `NODE_ENV=test` always keeps full emails so the browser tests can follow verification links). With the full-email switch on, this allows you to:

1. Test email flows without sending real emails
2. Inspect email content and formatting
3. Verify template variable substitution

### Production Testing

1. Use Postmark's sandbox mode for initial testing
2. Send test emails to yourself first
3. Check the Postmark activity stream for delivery status
4. Monitor webhook events for issues

## Email Types & Flows

### 1. Account Registration

**Flow:**

1. User registers → Verification email sent
2. User clicks link → Email verified
3. Welcome email sent

**Templates:** `verification.html`, `welcome.html`  
**Stream:** `outbound`

### 2. Password Reset

**Flow:**

1. User requests reset → Reset email sent
2. User clicks link → Opens reset page
3. User sets new password → Password updated

**Templates:** `password-reset.html`  
**Stream:** `password-reset`  
**Page:** `/reset-password.html`

### 3. Admin-Initiated Password Reset

**Flow:**

1. Admin triggers reset → Reset email sent to user
2. User receives email → Opens reset page
3. User sets new password → Password updated

**Templates:** `password-reset.html`  
**Stream:** `password-reset`

## Monitoring & Troubleshooting

### Check Email Status

1. Go to Postmark activity stream
2. Search by recipient email or MessageID
3. View delivery status, opens, clicks, bounces

### Common Issues

**Emails not sending:**

- Check `POSTMARK_API_KEY` is set correctly
- Verify sender domain/email is verified in Postmark
- Check server logs for error messages

**Emails going to spam:**

- Ensure SPF, DKIM, and return-path DNS records are configured
- Check Postmark sender reputation
- Review email content for spam trigger words

**Bounces:**

- Hard bounces: Email address doesn't exist (mark as invalid)
- Soft bounces: Temporary issue (Postmark will retry)
- Check bounce webhook events for details

### Logging

All email operations are logged with emoji prefixes:

- `📧` - Email sending attempt
- `✅` - Email sent successfully
- `❌` - Email sending failed
- `📬` - Webhook event received

Search logs for these to monitor email activity.

## Security Best Practices

1. **Never commit API keys** - Use environment variables
2. **Verify webhook requests** - Use basic auth or signature verification
3. **Use HTTPS only** - For webhook URLs
4. **Monitor bounces & complaints** - Maintain good sender reputation
5. **Rate limit emails** - Prevent abuse and API limit issues
6. **Validate email addresses** - Before attempting to send

## API Limits

Postmark free tier includes:

- 100 emails/month
- Full API access
- Webhook support

Paid plans start at $15/month for 10,000 emails.

## Support

- **Postmark Documentation:** https://postmarkapp.com/developer
- **Postmark Support:** https://postmarkapp.com/support
- **EventFlow Issues:** https://github.com/rhysllwydlewis/eventflow/issues

## Migration from Legacy Providers

EventFlow previously supported Mailgun, SendGrid, and Nodemailer. These have been removed in favor of Postmark exclusively.

**What changed:**

- ❌ Removed `@sendgrid/mail` dependency
- ❌ Removed `mailgun.js` dependency
- ❌ Removed `nodemailer` dependency
- ❌ Removed `utils/mailgun.js`
- ✅ Postmark is now the only email provider
- ✅ All emails use local templates (no hosted templates needed)
- ✅ Dedicated `password-reset` message stream for security

**No migration needed** - Just configure Postmark environment variables and you're ready!
