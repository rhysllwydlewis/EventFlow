# ALTCHA Implementation Guide

ALTCHA is a privacy-focused, self-hosted CAPTCHA alternative that uses a proof-of-work challenge mechanism instead of third-party tracking. No external API calls are required for verification.

## How ALTCHA Works

1. The client requests a challenge from the server (`GET /api/v1/altcha/challenge`)
2. The server generates a challenge using an HMAC key (via `altcha-lib`)
3. The `<altcha-widget>` web component solves the proof-of-work challenge automatically in the background
4. The client submits the solution payload with the form
5. The server verifies the solution locally (no external API call)

## Backend Setup (✅ Complete)

### 1. Environment Variable

Set `ALTCHA_HMAC_KEY` to a strong random secret:

```bash
openssl rand -base64 32
```

Add to your environment:

```
ALTCHA_HMAC_KEY=your_strong_random_key_here
```

In development, if `ALTCHA_HMAC_KEY` is not set, verification is skipped automatically.

### 2. Backend Verification Function

Location: `server.js`

```javascript
const { verifySolution } = require('altcha-lib');

async function verifyAltcha(payload) {
  if (!payload) {
    return { success: false, error: 'No ALTCHA payload provided' };
  }

  if (!process.env.ALTCHA_HMAC_KEY) {
    if (process.env.NODE_ENV === 'production') {
      return { success: false, error: 'CAPTCHA verification not configured' };
    }
    // Skip in development
    return { success: true, warning: 'Captcha verification disabled in development' };
  }

  const ok = await verifySolution(payload, process.env.ALTCHA_HMAC_KEY);
  return ok ? { success: true } : { success: false, error: 'ALTCHA verification failed' };
}
```

### 3. Challenge Endpoint

Location: `routes/misc.js` — `GET /api/v1/altcha/challenge`

```javascript
const { createChallenge } = require('altcha-lib');

router.get('/altcha/challenge', async (req, res) => {
  const challenge = await createChallenge({
    hmacKey: process.env.ALTCHA_HMAC_KEY,
    maxNumber: 100000,
  });
  res.json(challenge);
});
```

## Frontend Implementation (✅ Complete)

### Auth Registration Form (`public/auth.html`)

```html
<!-- Load ALTCHA web component (self-hosted to avoid browser tracking prevention) -->
<script src="/assets/js/vendor/altcha.min.js" defer></script>

<!-- Widget in the form -->
<altcha-widget challengeurl="/api/v1/altcha/challenge" id="reg-altcha-widget"></altcha-widget>
```

The ALTCHA payload is read from the widget on form submit:

```javascript
const altchaWidget = document.getElementById('reg-altcha-widget');
const altchaInput = altchaWidget ? altchaWidget.querySelector('input[name="altcha"]') : null;
payload.captchaToken = (altchaInput && altchaInput.value) || altchaWidget.value || null;
```

### Contact Form (`public/contact.html`)

Same pattern — the `<altcha-widget>` is rendered and the payload is read on submit.

### Utility Module (`public/assets/js/utils/altcha.js`)

A reusable ALTCHA utility module is available for other forms:

```javascript
import { addAltchaToForm, getAltchaPayload } from '/assets/js/utils/altcha.js';

// Add widget to a form
const { widget, getPayload } = await addAltchaToForm('#my-form');

// On submit, get the payload
const captchaToken = getPayload();
```

## Routes Updated (✅ Complete)

| Route | Change |
|-------|--------|
| `POST /api/v1/contact` | Calls `verifyAltcha(captchaToken)` |
| `POST /api/v1/auth/register` | Calls `verifyAltcha(captchaToken)` |
| `POST /api/v1/verify-captcha` | Calls `verifyAltcha(token)` |
| `GET /api/v1/altcha/challenge` | **New** — generates challenge |
| `GET /api/v1/config` | Returns `altchaChallengeUrl` |

## Security / CSP (✅ Complete)

The ALTCHA widget is now self-hosted at `/assets/js/vendor/altcha.min.js`, served from the same origin. This avoids browser Tracking Prevention features (Edge, Brave, Firefox, Safari) blocking `cdn.jsdelivr.net` from accessing storage, which previously prevented the `<altcha-widget>` web component from initialising.

`cdn.jsdelivr.net` is still in the CSP `scriptSrc`, `scriptSrcElem`, and `connectSrc` directives for any remaining CDN usage, but no additional CSP changes are needed for ALTCHA itself.

## NPM Dependencies

- `altcha-lib` — Server-side challenge creation and verification (no external API calls)
- ALTCHA frontend widget is self-hosted at `/assets/js/vendor/altcha.min.js` (sourced from the `altcha` npm package)

## Lead Scoring

Lead scoring uses the generic `captchaPassed` boolean field — no changes required. The ALTCHA verification result correctly sets `captchaPassed: true/false` in enquiry data.
