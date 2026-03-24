# ALTCHA Implementation Guide

ALTCHA is a privacy-focused, self-hosted CAPTCHA alternative that uses a proof-of-work challenge mechanism instead of third-party tracking. No external API calls are required for verification.

## How ALTCHA Works

1. The client requests a challenge from the server (`GET /api/v1/altcha/challenge`)
2. The server generates a challenge using an HMAC key (via `altcha-lib`)
3. The `<altcha-widget>` web component solves the proof-of-work challenge automatically in the background
4. The client submits the solution payload with the form
5. The server verifies the solution locally (no external API call)

## Root Cause of "No ALTCHA payload provided" Error (Fixed)

The HTTP 400 `{ "error": "No ALTCHA payload provided" }` error on registration was caused by two issues:

### Issue 1 – CDN dependency (primary cause)

The vendor shim (`altcha.min.js`) loaded the ALTCHA web component exclusively from CDN
(`cdn.jsdelivr.net`, `unpkg.com`). When an adblocker or privacy extension blocked the CDN
request, the widget never loaded and the 15-second timeout fallback fired.

The fallback message previously read **"Verification unavailable. You can still create an account."**
This was misleading: the backend always requires ALTCHA in production, so the form would always
return 400 regardless.

**Fix:** The `altcha` npm package (v2) is now installed as a `devDependency`. The widget
bundle is self-hosted at `/assets/js/vendor/altcha-widget.js`. The loader shim now tries the
self-hosted bundle first, then falls back to CDN sources.

### Issue 2 – No frontend submission guard

The `app.js` registration handler would submit the form even when `captchaToken` was null,
resulting in a guaranteed 400 from the backend.

**Fix:** The handler now validates the ALTCHA payload before calling `fetch`. If no payload is
found, it shows a clear message and returns without submitting.

### Issue 3 – Stale payload on cached page loads

When the page was loaded from cache, `altcha.min.js` might already have registered the custom
element before `auth-altcha-init.js` ran. In that case, the widget could auto-solve before the
`statechange` listener was attached, leaving `window.__altchaRegPayload` unset.

**Fix:** `auth-altcha-init.js` now reads the widget's current payload immediately after binding
the `statechange` listener (via Shadow DOM or `.value`), capturing any already-solved state.

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

### Self-hosted Widget Bundle

The actual ALTCHA web component is now self-hosted at `/assets/js/vendor/altcha-widget.js`
(copied from `node_modules/altcha/dist/altcha.js`). The loader shim at
`/assets/js/vendor/altcha.min.js` tries this path first before falling back to CDN.

To update the widget bundle after an `altcha` npm package upgrade:

```bash
cp node_modules/altcha/dist/altcha.js public/assets/js/vendor/altcha-widget.js
```

### Auth Registration Form (`public/auth.html`)

```html
<!-- Load ALTCHA web component (self-hosted, CDN fallback) -->
<script src="/assets/js/vendor/altcha.min.js" defer></script>

<!-- Widget in the form -->
<altcha-widget challengeurl="/api/v1/altcha/challenge" id="reg-altcha-widget"></altcha-widget>
```

The ALTCHA payload is captured via the widget's `statechange` event and stored in
`window.__altchaRegPayload`. The `auth-altcha-init.js` also reads the widget's current state
immediately after binding (in case the widget solved before the listener was attached):

```javascript
// In auth-altcha-init.js — bind event and capture any already-solved state
function bindAltchaEvents(widget) {
  if (!widget) return;
  widget.addEventListener('statechange', e => {
    if (e.detail && e.detail.state === 'verified') {
      window.__altchaRegPayload = e.detail.payload || readWidgetPayload(widget);
    } else {
      window.__altchaRegPayload = null;
    }
  });
  // Capture if already verified (cached page load)
  const existingPayload = readWidgetPayload(widget);
  if (existingPayload) {
    window.__altchaRegPayload = existingPayload;
  }
}
```

### Registration Submit Guard (`app.js`)

The registration handler blocks submission when no ALTCHA payload is available:

```javascript
const altchaWidget = document.getElementById('reg-altcha-widget');
if (altchaWidget) {
  // Priority: statechange-captured → Shadow DOM → .value
  let captchaToken = window.__altchaRegPayload || null;
  if (!captchaToken) {
    try {
      if (altchaWidget.shadowRoot) {
        const shadowInput = altchaWidget.shadowRoot.querySelector('input[name="altcha"]');
        if (shadowInput && shadowInput.value) captchaToken = shadowInput.value;
      }
    } catch (_) {}
    if (!captchaToken) captchaToken = altchaWidget.value || null;
  }
  if (!captchaToken) {
    // Block submission with a clear message
    regStatus.textContent =
      'Please complete the verification challenge before creating your account.';
    regBtn.disabled = false;
    return;
  }
  payload.captchaToken = captchaToken;
} else if (window.__altchaUnavailable) {
  // Widget failed to load entirely
  regStatus.textContent = 'Verification is unavailable. Please refresh the page and try again.';
  regBtn.disabled = false;
  return;
}
```

### Contact Form (`public/contact.html`)

Same event-driven pattern — a `captchaPayload` variable is updated via `statechange` and read on submit:

```javascript
var captchaPayload = null;

function bindAltchaEvents(widget) {
  if (!widget) return;
  widget.addEventListener('statechange', function (e) {
    if (e.detail && e.detail.state === 'verified') {
      captchaPayload = e.detail.payload;
    } else {
      captchaPayload = null;
    }
  });
}

// On submit
var captchaToken = captchaPayload || (altchaWidget && altchaWidget.value) || null;
```

> **Why not `querySelector('input[name="altcha"]')`?**  
> The hidden `<input name="altcha">` is rendered inside the `<altcha-widget>` **Shadow DOM**. Standard `querySelector` cannot cross the Shadow DOM boundary and always returns `null`. The `statechange` event approach is the correct, spec-compliant way to read the payload. As a secondary fallback, `shadowRoot.querySelector('input[name="altcha"]')` is used.

### Utility Module (`public/assets/js/utils/altcha.js`)

A reusable ALTCHA utility module is available for other forms. `getAltchaPayload()` tries Shadow DOM → light DOM → widget descendants → `.value` in order:

```javascript
import { addAltchaToForm, getAltchaPayload } from '/assets/js/utils/altcha.js';

// Add widget to a form
const { widget, getPayload } = await addAltchaToForm('#my-form');

// On submit, get the payload
const captchaToken = getPayload();
```

## Routes Updated (✅ Complete)

| Route                          | Change                             |
| ------------------------------ | ---------------------------------- |
| `POST /api/v1/contact`         | Calls `verifyAltcha(captchaToken)` |
| `POST /api/v1/auth/register`   | Calls `verifyAltcha(captchaToken)` |
| `POST /api/v1/verify-captcha`  | Calls `verifyAltcha(token)`        |
| `GET /api/v1/altcha/challenge` | **New** — generates challenge      |
| `GET /api/v1/config`           | Returns `altchaChallengeUrl`       |

## Security / CSP (✅ Complete)

The ALTCHA widget is now self-hosted at `/assets/js/vendor/altcha-widget.js`, served from the
same origin. This avoids browser Tracking Prevention features (Edge, Brave, Firefox, Safari)
and adblocker interference from blocking CDN resources.

`cdn.jsdelivr.net` is still in the CSP `scriptSrc`, `scriptSrcElem`, and `connectSrc`
directives for CDN fallback, but the self-hosted bundle will be used in normal operation.

## NPM Dependencies

- `altcha-lib` — Server-side challenge creation and verification (no external API calls)
- `altcha` (devDependency) — Frontend widget source; bundle copied to `public/assets/js/vendor/altcha-widget.js`

## Lead Scoring

Lead scoring uses the generic `captchaPassed` boolean field — no changes required. The ALTCHA verification result correctly sets `captchaPassed: true/false` in enquiry data.
