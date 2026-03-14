# Phone & Email Verification Guide

## Overview

EventFlow provides comprehensive verification systems for both phone numbers and email addresses. These systems help establish trust, reduce spam, and improve user experience.

## Email Verification

### Architecture

**Components:**

- `routes/emailVerification.js` - Email verification endpoints
- `routes/auth.js` - Auto-send on registration
- `utils/postmark.js` - Email delivery service

**Database Fields:**

```javascript
{
  emailVerified: boolean,
  emailVerificationToken: string,
  emailVerificationExpires: datetime
}
```

### API Endpoints

#### 1. Send/Resend Verification Email

**Endpoint:** `POST /api/auth/send-verification`

**Authentication:** Required

**Rate Limiting:** resendEmailLimiter (prevents spam)

**Request:**

```http
POST /api/auth/send-verification
Cookie: auth=<jwt-token>
```

**Response:**

```json
{
  "ok": true,
  "message": "Verification email sent successfully",
  "expiresIn": 86400
}
```

**Notes:**

- Token expires in 24 hours
- Rate limited to prevent abuse
- Returns success even if already verified

#### 2. Verify Email

**Endpoint:** `GET /api/auth/verify-email/:token`

**Authentication:** Not required (uses token)

**Request:**

```http
GET /api/auth/verify-email/a1b2c3d4e5f6...
```

**Response:**

```json
{
  "ok": true,
  "message": "Email verified successfully"
}
```

**Error Responses:**

```json
{
  "ok": false,
  "error": "Invalid or expired token",
  "message": "This verification link is not valid"
}
```

```json
{
  "ok": false,
  "error": "Token expired",
  "message": "This verification link has expired. Please request a new one."
}
```

#### 3. Check Email Status

**Endpoint:** `GET /api/auth/email-status`

**Authentication:** Required

**Response:**

```json
{
  "ok": true,
  "verified": true,
  "email": "user@example.com"
}
```

### Automatic Verification on Registration

Email verification is automatically triggered when a user registers:

**Flow:**

1. User submits registration form
2. System generates 32-byte random token
3. Token stored in database with 24-hour expiry
4. Verification email sent via Postmark
5. User clicks link in email
6. Token validated and user marked as verified

**Implementation:** See `routes/auth.js` lines 303-331

### Email Template

The verification email includes:

- Welcome message
- Clickable verification button
- Plain text link (for email clients without HTML)
- 24-hour expiry notice
- "Didn't create this account?" message

### Frontend Integration

**HTML Banner (for unverified users):**

```html
<div id="emailBanner" class="alert alert-warning" style="display: none;">
  <span>Email not verified.</span>
  <button id="resendEmail" class="btn btn-sm btn-primary">Resend Verification</button>
</div>
```

**JavaScript:**

```javascript
// Check verification status on page load
async function checkEmailStatus() {
  const response = await fetch('/api/auth/email-status', {
    credentials: 'include',
  });
  const data = await response.json();

  if (!data.verified) {
    document.getElementById('emailBanner').style.display = 'block';
  }
}

// Resend verification email
document.getElementById('resendEmail').addEventListener('click', async () => {
  const response = await fetch('/api/auth/send-verification', {
    method: 'POST',
    credentials: 'include',
  });

  if (response.ok) {
    alert('Verification email sent! Check your inbox.');
  }
});
```

---

## Phone Verification

### Architecture

**Components:**

- `routes/phoneVerification.js` - Phone verification endpoints
- Twilio API - SMS delivery service
- Development mode - Returns code without SMS

**Database Fields:**

```javascript
{
  phoneNumber: string,
  phoneVerified: boolean,
  phoneVerificationCode: string,
  phoneVerificationExpires: datetime,
  phoneNumberToVerify: string  // Pending verification
}
```

### API Endpoints

#### 1. Send Verification Code

**Endpoint:** `POST /api/me/phone/send-code`

**Authentication:** Required

**Rate Limiting:** writeLimiter

**CSRF Protection:** Required

**Request:**

```json
{
  "phoneNumber": "+447123456789"
}
```

**Response (Production):**

```json
{
  "ok": true,
  "message": "Verification code sent successfully",
  "expiresIn": 600
}
```

**Response (Development - Twilio not configured):**

```json
{
  "ok": true,
  "message": "Development mode: Twilio not configured",
  "code": "123456",
  "expiresIn": 600
}
```

**Phone Number Format:**

- International format: `+[country code][number]`
- Examples: `+447123456789`, `+14155552671`, `+61412345678`
- Regex: `/^\+?[1-9]\d{1,14}$/`

**Error Responses:**

```json
{
  "ok": false,
  "error": "Invalid phone number format",
  "message": "Phone number must be in international format (e.g., +44 7123 456789)"
}
```

#### 2. Verify Code

**Endpoint:** `POST /api/me/phone/verify-code`

**Authentication:** Required

**CSRF Protection:** Required

**Request:**

```json
{
  "code": "123456"
}
```

**Response:**

```json
{
  "ok": true,
  "message": "Phone number verified successfully",
  "phoneNumber": "+447123456789"
}
```

**Error Responses:**

```json
{
  "ok": false,
  "error": "Invalid code",
  "message": "The code you entered is incorrect"
}
```

```json
{
  "ok": false,
  "error": "Expired",
  "message": "Please request a new verification code"
}
```

#### 3. Remove Phone Number

**Endpoint:** `DELETE /api/me/phone`

**Authentication:** Required

**CSRF Protection:** Required

**Response:**

```json
{
  "ok": true,
  "message": "Phone number removed successfully"
}
```

#### 4. Check Phone Status

**Endpoint:** `GET /api/me/phone/status`

**Authentication:** Required

**Response:**

```json
{
  "ok": true,
  "phoneNumber": "+447123456789",
  "verified": true
}
```

### Twilio Configuration

**Environment Variables:**

```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+441234567890
```

**Get Credentials:**

1. Sign up at https://www.twilio.com/console
2. Navigate to Account Settings
3. Copy Account SID and Auth Token
4. Purchase a phone number with SMS capabilities

**Development Mode:**

- If Twilio credentials are not set, system operates in development mode
- Returns verification code in API response
- No SMS sent
- Useful for testing without Twilio account

### SMS Message Format

```
EventFlow code: 123456
```

Simple, clear format that:

- Identifies the sender (EventFlow)
- Shows the verification code
- Fits within SMS character limits

### Security Features

**Code Generation:**

- 6-digit random code: `Math.floor(100000 + Math.random() * 900000)`
- Expires in 10 minutes
- Stored in database until verified or expired

**Rate Limiting:**

- Send-code endpoint protected with writeLimiter
- Prevents SMS spam
- Default: 30 requests per 15 minutes

**Validation:**

- Phone number format validation
- Code expiry checking
- One-time use (removed after verification)

### Frontend Integration

**HTML Form:**

```html
<div class="phone-verification">
  <h3>Verify Your Phone Number</h3>

  <div id="phoneInput">
    <input type="tel" id="phone" placeholder="+44 7123 456789" pattern="^\+?[1-9]\d{1,14}$" />
    <button id="sendCode">Send Code</button>
  </div>

  <div id="codeInput" style="display: none;">
    <input type="text" id="code" placeholder="6-digit code" maxlength="6" pattern="[0-9]{6}" />
    <button id="verifyCode">Verify</button>
    <p id="countdown"></p>
  </div>
</div>
```

**JavaScript:**

```javascript
// Send verification code
document.getElementById('sendCode').addEventListener('click', async () => {
  const phoneNumber = document.getElementById('phone').value;

  const response = await fetch('/api/me/phone/send-code', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': getCsrfToken(),
    },
    credentials: 'include',
    body: JSON.stringify({ phoneNumber }),
  });

  const data = await response.json();

  if (data.ok) {
    // Show code input
    document.getElementById('phoneInput').style.display = 'none';
    document.getElementById('codeInput').style.display = 'block';

    // Start countdown timer
    startCountdown(data.expiresIn);

    // In development, show the code
    if (data.code) {
      console.log('Dev mode - Code:', data.code);
    }
  }
});

// Verify code
document.getElementById('verifyCode').addEventListener('click', async () => {
  const code = document.getElementById('code').value;

  const response = await fetch('/api/me/phone/verify-code', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': getCsrfToken(),
    },
    credentials: 'include',
    body: JSON.stringify({ code }),
  });

  if (response.ok) {
    alert('Phone number verified successfully!');
    location.reload();
  }
});

// Countdown timer
function startCountdown(seconds) {
  const countdown = document.getElementById('countdown');
  let remaining = seconds;

  const timer = setInterval(() => {
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    countdown.textContent = `Code expires in ${mins}:${secs.toString().padStart(2, '0')}`;

    if (--remaining < 0) {
      clearInterval(timer);
      countdown.textContent = 'Code expired. Request a new one.';
    }
  }, 1000);
}
```

---

## Integration with Verification Badges

Both email and phone verification can display badges using the existing verification badge system:

```javascript
// From public/assets/js/utils/verification-badges.js
renderVerificationBadges(['email-verified', 'phone-verified'], element);
```

See `docs/ALTCHA_IMPLEMENTATION_GUIDE.md` for badge integration examples.

---

## Testing

### Email Verification Tests

**Manual Testing:**

```bash
# 1. Register user (triggers auto-send)
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test123!"}'

# 2. Check email in /outbox directory (development)
cat outbox/verification_*.html

# 3. Extract token from email and verify
curl http://localhost:3000/api/auth/verify-email/TOKEN

# 4. Check status
curl http://localhost:3000/api/auth/email-status \
  -H "Cookie: auth=JWT"
```

### Phone Verification Tests

**Development Mode (No Twilio):**

```bash
# 1. Send code
curl -X POST http://localhost:3000/api/me/phone/send-code \
  -H "Cookie: auth=JWT" \
  -H "X-CSRF-Token: TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber":"+447123456789"}'

# Response includes code in development:
# {"ok":true,"code":"123456","expiresIn":600}

# 2. Verify code
curl -X POST http://localhost:3000/api/me/phone/verify-code \
  -H "Cookie: auth=JWT" \
  -H "X-CSRF-Token: TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"code":"123456"}'
```

### Integration Tests

Run the test suite:

```bash
npm test -- tests/integration/security-features.test.js
```

Tests include:

- Phone number validation regex
- 6-digit code generation
- Email token generation

---

## Troubleshooting

### Email Verification

**Problem:** Verification email not received

**Solutions:**

1. Check spam folder
2. Verify Postmark configuration
3. Check `/outbox` folder in development
4. Ensure email sending didn't fail (check logs)

**Problem:** "Token expired" error

**Solution:**

- Token expires after 24 hours
- Request a new verification email

### Phone Verification

**Problem:** SMS not received

**Solutions:**

1. Check phone number format (must start with +)
2. Verify Twilio account has credit
3. Check Twilio phone number has SMS capabilities
4. Review Twilio dashboard for delivery status

**Problem:** "Invalid code" error

**Solutions:**

- Code is case-sensitive
- Code expires after 10 minutes
- Request a new code
- Check for typos

**Problem:** Development mode shows code in response

**Solution:**

- This is expected behavior when Twilio is not configured
- Set TWILIO\_\* environment variables for production

---

## Best Practices

### For Users

1. Use real phone numbers (not VOIP for critical accounts)
2. Keep phone number updated
3. Save verification emails for record-keeping
4. Don't share verification codes

### For Developers

1. Always validate phone number format
2. Implement rate limiting to prevent SMS spam
3. Use short expiry times for codes (10 minutes)
4. Log verification attempts for security monitoring
5. Never expose codes in production logs
6. Handle Twilio failures gracefully
7. Provide clear error messages

---

## Cost Considerations

### Email (Postmark)

- Free tier: 100 emails/month
- Paid: $10/month for 10,000 emails
- Cost per email: ~$0.001

### SMS (Twilio)

- Cost varies by country
- UK: ~£0.04 per SMS
- US: ~$0.0075 per SMS
- Consider: Monthly service charges, number rental

**Optimization Tips:**

- Cache verification status
- Limit resend frequency
- Consider email-only for low-security features
- Use SMS only for high-value accounts

---

## Future Enhancements

Potential improvements:

- [ ] Voice call verification as fallback
- [ ] WhatsApp/Telegram verification
- [ ] Email + phone combined verification
- [ ] Verification badge display on profiles
- [ ] Admin dashboard for verification analytics
- [ ] Bulk verification status export
- [ ] Automated expiry cleanup jobs

---

## Security Considerations

### Email Verification

- **Threat:** Email interception
- **Mitigation:** HTTPS links, short token expiry

### Phone Verification

- **Threat:** SIM swapping
- **Mitigation:** Monitor for unusual patterns, require additional verification for critical changes

### Both

- Rate limiting prevents abuse
- CSRF protection on all endpoints
- Authentication required for sensitive operations

---

## References

- [Postmark API Docs](https://postmarkapp.com/developer)
- [Twilio SMS API](https://www.twilio.com/docs/sms)
- [OWASP Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [E.164 Phone Number Format](https://en.wikipedia.org/wiki/E.164)
