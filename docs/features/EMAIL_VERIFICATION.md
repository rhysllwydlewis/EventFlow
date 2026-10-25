# Email Verification System Documentation

## 🎉 **NEW: JWT Token System**

**As of v5.3.0, EventFlow uses JWT (JSON Web Tokens) for email verification with HMAC-SHA256 signing.**

**Key Improvements:**

- ✅ Cryptographically secure tokens (HMAC-SHA256 signature)
- ✅ Token versioning for instant revocation capability
- ✅ 5-minute grace period for expired tokens
- ✅ Backward compatible with legacy tokens during transition
- ✅ Enhanced error messages with specific error codes
- ✅ Comprehensive logging for debugging
- ✅ 92% code coverage with 47+ tests

**See:** [`docs/TOKEN_SECURITY.md`](docs/TOKEN_SECURITY.md) for detailed JWT implementation and security information.

---

## Overview

EventFlow uses a secure, token-based email verification system powered by Postmark to verify user email addresses during registration. This document covers the complete email verification workflow, template management, testing, and troubleshooting.

## System Architecture

### Components

1. **Backend API** (`routes/auth.js`)
   - `/api/auth/register` - Creates user account and sends verification email
   - `/api/auth/verify` - Validates verification token and activates account
2. **Email Service** (`utils/postmark.js`)
   - Sends verification emails using Postmark API
   - Manages HTML email templates
   - Handles token generation and validation

3. **Email Templates** (`email-templates/`)
   - `verification.html` - Welcome email with verification link
   - `welcome.html` - Post-verification welcome email
4. **Frontend** (`public/verify.html`)
   - Handles verification link clicks
   - Displays verification status to user
   - Auto-redirects to login on success

## Workflow

### 1. User Registration

```
User submits registration form
  ↓
POST /api/auth/register
  ↓
Generate JWT verification token (24-hour expiry)
  - Signed with HMAC-SHA256
  - Includes user ID, email, expiration
  - Token version for revocation
  ↓
Send verification email via Postmark
  ↓
If email succeeds: Save user to database
If email fails: Return error, don't create account
  ↓
Return success response with session cookie
```

**Key Features:**

- ✅ Verification email sent BEFORE user creation (prevents orphaned accounts)
- ✅ JWT token with HMAC-SHA256 signature (prevents tampering)
- ✅ Token expires after 24 hours (configurable)
- ✅ 5-minute grace period after expiration
- ✅ User cannot login until verified
- ✅ Token versioning for instant revocation

### 2. Email Verification

```
User clicks verification link in email
  ↓
GET /verify.html?token=...
  ↓
JavaScript calls GET /api/auth/verify?token=...
  ↓
Backend validates token:
  - Check token exists
  - Check token not expired
  - Check user not already verified
  ↓
If valid:
  - Mark user as verified
  - Remove token
  - Send welcome email (async)
  - Return success
If invalid:
  - Return appropriate error message
  ↓
Frontend displays status and redirects to login
```

### 3. Login Protection

```
User attempts login
  ↓
POST /api/auth/login
  ↓
Check credentials
  ↓
Check user.verified === true
  ↓
If verified: Allow login
If not verified: Return 403 with helpful message
```

### 4. Resend Verification Email

Users can request a new verification email if the original email was not received or has expired.

#### User-Initiated Resend

```
User navigates to /verify.html (without token)
OR clicks "Resend email" after registration
  ↓
Enter email address
  ↓
POST /api/auth/resend-verification { email }
  ↓
Backend:
  - Find user by email (case-insensitive)
  - Check if user is already verified
  - Generate new verification token (24-hour expiry)
  - Send new verification email via Postmark
  - Update user record with new token
  ↓
Return success (without revealing if email exists)
```

#### Admin-Initiated Resend

```
Admin views unverified user in /admin-users.html
  ↓
Click "Resend Verification" button
  ↓
Confirm action
  ↓
POST /api/admin/users/:userId/resend-verification
  ↓
Backend:
  - Verify admin permissions
  - Find user by ID
  - Check if user is already verified
  - Generate new verification token (24-hour expiry)
  - Send new verification email via Postmark
  - Update user record with new token
  - Log action in audit trail
  ↓
Show toast notification with result
```

**Key Features:**

- ✅ Rate limited to prevent abuse
- ✅ Previous token is invalidated when new one is generated
- ✅ Generic success message prevents email enumeration
- ✅ Admin actions are logged in audit trail
- ✅ Clear UI feedback with toast notifications

## Email Templates

### Location

All email templates are stored in `/email-templates/` directory.

### Verification Email Template

**File:** `email-templates/verification.html`

**Features:**

- ✅ Dark mode support (using `prefers-color-scheme`)
- ✅ Mobile responsive design
- ✅ Prominent CTA button with gradient
- ✅ Fallback link for email clients that don't support buttons
- ✅ Security notice with 24-hour expiration warning
- ✅ Consistent EventFlow branding
- ✅ Professional layout with proper spacing

**Template Variables:**

- `{{name}}` - User's name (defaults to "there" if not provided)
- `{{verificationLink}}` - Full verification URL with token
- `{{baseUrl}}` - Application base URL (from APP_BASE_URL env var)
- `{{year}}` - Current year (auto-populated)

**Example Link:**

```
https://event-flow.co.uk/verify.html?token=verify_abc123xyz789
```

### Welcome Email Template

**File:** `email-templates/welcome.html`

Sent automatically after successful email verification. Features overview of platform capabilities and next steps.

### Template Customization

To modify email templates:

1. Edit the HTML file in `/email-templates/`
2. Use `{{variable}}` syntax for dynamic content
3. Test locally by triggering the workflow
4. Check `/outbox/` folder for rendered output (when Postmark not configured)

**Template Best Practices:**

- Keep HTML inline-styled (many email clients strip external CSS)
- Test in multiple email clients (Gmail, Outlook, Apple Mail)
- Use responsive design with media queries
- Provide text-only fallback
- Include unsubscribe links for marketing emails (not required for transactional)

## Configuration

### Environment Variables

Required for email verification:

```env
# Postmark Configuration
POSTMARK_API_KEY=your-postmark-server-token
POSTMARK_FROM=admin@event-flow.co.uk

# Application URL (for email links)
APP_BASE_URL=https://event-flow.co.uk

# JWT Secret (for session tokens)
JWT_SECRET=your-secure-random-secret

# Optional: Webhook authentication
POSTMARK_WEBHOOK_USER=postmark-webhook
POSTMARK_WEBHOOK_PASS=your-secure-webhook-password
```

### Postmark Setup

1. **Create Postmark Account**
   - Sign up at https://postmarkapp.com
   - Verify your sender email/domain

2. **Get API Key**
   - Go to Account → API Tokens
   - Create a Server API Token
   - Copy and set as `POSTMARK_API_KEY`

3. **Configure Sender**
   - Go to Sender Signatures
   - Add and verify `admin@event-flow.co.uk`
   - Set as `POSTMARK_FROM`

4. **Setup Webhooks (Optional but Recommended)**
   - Go to your Server → Webhooks
   - Add webhook URL: `https://event-flow.co.uk/api/webhooks/postmark`
   - Select events: Delivery, Bounce, SpamComplaint
   - Configure Basic Auth with username and password
   - Set matching credentials in environment variables

## Postmark Webhook URL

Configure this webhook in your Postmark dashboard to receive delivery notifications:

```
https://event-flow.co.uk/api/webhooks/postmark
```

**Recommended Events to Track:**

- ✅ Delivery - Confirms email was delivered successfully
- ✅ Bounce - Alerts when email bounces (invalid address)
- ✅ SpamComplaint - Critical: User marked email as spam

**Security:**
The webhook endpoint supports Basic Authentication. Set these environment variables and configure matching credentials in Postmark:

- `POSTMARK_WEBHOOK_USER` - Username for webhook auth
- `POSTMARK_WEBHOOK_PASS` - Password for webhook auth

See `/routes/webhooks.js` for webhook implementation details.

## Testing

### Local Development Testing

1. **Set Development Mode**

   ```env
   NODE_ENV=development
   EMAIL_ENABLED=false  # Emails saved to /outbox instead
   ```

2. **Trigger Registration**

   ```bash
   curl -X POST http://localhost:3000/api/auth/register \
     -H "Content-Type: application/json" \
     -d '{
       "name": "Test User",
       "email": "test@example.com",
       "password": "TestPass123",
       "role": "customer"
     }'
   ```

3. **Check Outbox** (set `EVENTFLOW_OUTBOX_FULL=1` first, otherwise only metadata is written and there is no link to read)

   ```bash
   ls -la outbox/
   cat outbox/email-*.eml
   ```

4. **Extract Token from Email**
   Look for the verification link in the email file

5. **Test Verification**
   ```bash
   curl http://localhost:3000/api/auth/verify?token=YOUR_TOKEN
   ```

### Automated Tests

Run the test suite:

```bash
# All verification tests
npm test -- email-verification

# Unit tests only
npm test -- tests/unit/email-verification.test.js

# Integration tests only
npm test -- tests/integration/email-verification.test.js
```

**Test Coverage:**

- ✅ Email template loading and rendering
- ✅ HTML escaping (XSS prevention)
- ✅ Dark mode support validation
- ✅ Token generation and uniqueness
- ✅ Registration with email sending
- ✅ Verification token validation
- ✅ Token expiration handling
- ✅ Login blocking for unverified users
- ✅ Complete registration → verification → login flow
- ✅ Error handling for invalid/expired tokens

### Manual Testing Checklist

- [ ] Register new account - email sent
- [ ] Check email received in inbox (not spam)
- [ ] Click verification link - redirects to verify.html
- [ ] Verify.html shows success message
- [ ] Try to login before verification - blocked with helpful message
- [ ] Complete verification - success
- [ ] Login after verification - allowed
- [ ] Try to verify with expired token - clear error message
- [ ] Try to verify with invalid token - clear error message
- [ ] Try to verify same token twice - appropriate handling
- [ ] Check welcome email received after verification
- [ ] Test on mobile device - email renders correctly
- [ ] Test in dark mode - email styling adapts correctly

## Troubleshooting

### Email Not Received

**Check:**

1. Postmark API key is correct (`POSTMARK_API_KEY`)
2. Sender email is verified in Postmark
3. Check spam/junk folder
4. Check Postmark activity logs
5. Verify `APP_BASE_URL` is set correctly
6. Check server logs for email sending errors

**Common Issues:**

- Domain not verified in Postmark
- API key invalid or expired
- Rate limiting (Postmark sandbox has limits)
- Email blocked by recipient server

### Verification Link Shows 404

**This was the reported issue.** The verify.html page exists and is fully functional. If you're getting a 404:

1. **Check the URL is correct:**

   ```
   https://event-flow.co.uk/verify.html?token=...
   ```

2. **Ensure verify.html is deployed:**

   ```bash
   # Check file exists
   ls -la public/verify.html
   ```

3. **Check server is serving static files:**

   ```javascript
   // In server.js
   app.use(express.static('public'));
   ```

4. **Test direct access:**
   ```
   https://event-flow.co.uk/verify.html
   ```

### Verification Token Expired

Users see: "Verification token has expired. Please request a new one."

**Solution:** Currently, users must re-register.

**Future Enhancement:** Add `/api/auth/resend-verification` endpoint to resend verification email without re-registering.

### User Already Verified

Backend handles this gracefully by not throwing an error if user verifies twice.

### Verification Page Not Working

**Check:**

1. JavaScript console for errors
2. Browser supports ES6 async/await
3. No CORS issues (same domain)
4. Network tab shows API call to `/api/auth/verify`

**Common Issues:**

- Ad blockers blocking scripts
- JavaScript disabled
- Browser too old (needs ES6 support)

## Security Considerations

### Token Security

- ✅ Tokens are cryptographically random via `uid('verify')`
- ✅ Tokens stored hashed in database (if using hashed storage)
- ✅ Tokens expire after 24 hours
- ✅ Tokens are single-use (deleted after verification)
- ✅ Cannot guess valid tokens (high entropy)

### Email Security

- ✅ HTML is sanitized before rendering
- ✅ Template variables are HTML-escaped
- ✅ No user-generated content in verification emails
- ✅ HTTPS required for verification links (enforced in production)

### Rate Limiting

- ✅ Registration endpoint has rate limiting (via `authLimiter`)
- ✅ Prevents spam registrations
- ✅ Prevents token enumeration attacks

## Monitoring

### Key Metrics to Track

1. **Email Delivery Rate**
   - Track via Postmark webhooks
   - Target: >99% delivery rate

2. **Verification Rate**
   - % of users who complete verification
   - Target: >80% within 24 hours

3. **Token Expiration Rate**
   - % of tokens that expire unused
   - High rate indicates UX issues

4. **Bounce Rate**
   - Hard bounces indicate invalid emails
   - Should be <2% for legitimate users

### Postmark Activity Log

Monitor in Postmark dashboard:

- Message Activity - See all sent emails
- Bounce Activity - Track bounced emails
- Spam Complaints - Critical to monitor

### Server Logs

Look for these log messages:

```
✅ Verification email sent successfully to user@example.com
✅ Email verified successfully
❌ Failed to send verification email: [error]
⚠️  Verification token expired
```

## Maintenance

### Regular Tasks

1. **Clean Up Expired Tokens**
   - Run periodic cleanup job
   - Delete users with expired tokens who never verified (optional)

2. **Monitor Bounce Rates**
   - Check Postmark for bounces
   - Flag or remove invalid email addresses

3. **Update Email Templates**
   - Review and refresh design quarterly
   - Test in new email clients
   - A/B test subject lines and copy

4. **Review Verification Rate**
   - If low, investigate UX issues
   - Consider shorter expiration time
   - Check spam folder placement

### Email Template Updates

To update the verification email template:

1. Edit `/email-templates/verification.html`
2. Test locally with `EMAIL_ENABLED=false`
3. Check rendered output in `/outbox/`
4. Test in multiple email clients
5. Deploy and monitor delivery rates

## Additional Resources

- **Postmark Documentation:** https://postmarkapp.com/developer
- **Postmark Setup Guide:** See `POSTMARK_SETUP.md`
- **API Documentation:** See `API_DOCUMENTATION.md`
- **Route Implementation:** See `routes/auth.js`
- **Email Utility:** See `utils/postmark.js`
- **Webhook Handler:** See `routes/webhooks.js`

## Support

For issues or questions:

1. Check server logs for errors
2. Check Postmark activity logs
3. Review this documentation
4. Check test suite for examples
5. Contact support with relevant log excerpts
