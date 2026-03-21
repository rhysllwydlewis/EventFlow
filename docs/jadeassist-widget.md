# JadeAssist Widget Documentation

This document describes how the JadeAssist chat widget is configured and customized for EventFlow.

## Overview

The JadeAssist widget is a chat assistant that helps users find venues and suppliers. It's positioned on the left side of the screen, aligned vertically with the back-to-top button (which is on the right side).

JadeAssist is deployed as an **independently deployable service on Railway**, separate from EventFlow. EventFlow embeds the widget script and points it at the Railway backend API.

## Architecture

```
event-flow.co.uk (EventFlow — Railway)
  └─ embeds /assets/js/vendor/jade-widget.js  (self-hosted widget bundle)
  └─ loads  /assets/js/jadeassist-init.v2.js  (init + teaser)
       └─ calls JadeWidget.init({ apiBaseUrl: 'https://jadeassistbackend-production.up.railway.app' })
                                                     │
                                               JadeAssist Backend (Railway)
                                               https://jadeassistbackend-production.up.railway.app
```

## Railway Deployment

JadeAssist runs as two separate Railway services:

| Service | Public URL |
|---------|-----------|
| Backend (API) | `https://jadeassistbackend-production.up.railway.app` |
| Widget (serves widget bundle) | `https://jadeassistwidget-production.up.railway.app` |

> **Note:** EventFlow self-hosts the widget bundle (see [Widget Library](#widget-library-self-hosted)) to avoid browser tracking prevention blocking CDN requests. The widget service URL above is for reference only — EventFlow does **not** load scripts from it.

## Changing the Backend URL

The backend URL is stored as a **single source of truth** in two places:

### 1. Environment variable (recommended for Railway)

Set `JADEASSIST_API_BASE_URL` in the EventFlow Railway service environment:

```
JADEASSIST_API_BASE_URL=https://jadeassistbackend-production.up.railway.app
```

The server exposes this via the `/api/config` endpoint (see `routes/system.js`).

### 2. `window.JADEASSIST_CONFIG` override (optional, no redeploy needed)

You can override the URL before the init script loads by injecting a config snippet:

```html
<script>window.JADEASSIST_CONFIG = { apiBaseUrl: 'https://your-backend.up.railway.app' };</script>
<script src="/assets/js/vendor/jade-widget.js" defer></script>
<script src="/assets/js/jadeassist-init.v2.js" defer></script>
```

### 3. Built-in default

If neither of the above is set, `jadeassist-init.v2.js` falls back to the hardcoded Railway URL:

```javascript
const API_BASE_URL =
  (window.JADEASSIST_CONFIG && window.JADEASSIST_CONFIG.apiBaseUrl) ||
  'https://jadeassistbackend-production.up.railway.app';
```

To update this default: edit `API_BASE_URL` near the top of `public/assets/js/jadeassist-init.v2.js`.

## Configuration Files

- **`public/assets/js/jadeassist-init.v2.js`** — **Current version** used across all pages. Features teaser bubble with A/B testing, full keyboard accessibility, analytics events, safe-area inset support, and debug diagnostics.
- **`public/assets/js/jadeassist-init.js`** — Legacy version kept for reference. Not loaded by any HTML page.

## Public Page Coverage

The widget is loaded on **all public EventFlow pages** via the two script tags included in every public HTML file:

```html
<script src="/assets/js/vendor/jade-widget.js" defer></script>
<script src="/assets/js/jadeassist-init.v2.js" defer></script>
```

Public pages include: `/` (homepage), `/start`, `/suppliers`, `/marketplace`, `/guides`, `/pricing`,
`/faq`, `/contact`, `/for-suppliers`, `/articles/*`, `/supplier` (profile view), `/package`,
`/category`, `/compare`, `/gallery`, `/legal`, `/privacy`, `/terms`, `/auth`, and more.

Authenticated-only pages (dashboard, messenger, settings, admin) intentionally do not require the
widget and are excluded.

## Debug Mode

Append `?jade-debug` to any page URL to enable diagnostic logs in the browser console. This works in **all environments** (production, staging, localhost).

### What debug mode logs

- Init config summary (including `apiBaseUrl`, colors, avatar URL, positioning offsets, scale)
- Avatar load success or failure with the full URL tested
- Widget initialized successfully ✅
- Teaser triggered (method + variant + mobile flag)
- Auto-dismiss timing

### Enabling debug mode

```
# Any page, any environment
https://www.event-flow.co.uk/?jade-debug

# Specific page
https://www.event-flow.co.uk/plan?jade-debug
```

Debug mode is also automatically enabled on `localhost`, `127.0.0.1`, `*.local`, `dev.*`, and `staging.*` hostnames.

## Avatar Image

### Current Avatar

The widget uses a custom avatar image located at:

```
public/assets/images/jade-avatar.png
```

This is a 1513011-byte PNG image that displays a professional avatar for the Jade assistant.

### Replacing the Avatar

To replace the avatar image:

1. **Prepare your image:**
   - Recommended size: 200x200 pixels or larger (will be scaled)
   - Format: PNG with transparency preferred
   - File size: Keep under 2MB for optimal loading
   - Name it: `jade-avatar.png`

2. **Replace the file:**

   ```bash
   # Backup the old avatar (optional)
   cp public/assets/images/jade-avatar.png public/assets/images/jade-avatar.png.backup

   # Copy your new avatar
   cp /path/to/your/new-avatar.png public/assets/images/jade-avatar.png
   ```

3. **Test the avatar loads:**
   - Open any page with the widget (e.g., index.html)
   - Open browser DevTools Console
   - Look for the log message: `JadeAssist avatar URL: /assets/images/jade-avatar.png`
   - Verify you see: `✅ JadeAssist avatar loaded successfully`
   - If you see a warning, check the Network tab to see if the image request failed

### Subpath Deployments

The widget initialization automatically resolves the avatar path for deployments under a subpath:

- **Root deployment** (e.g., `https://example.com/`): Uses `/assets/images/jade-avatar.png`
- **Subpath deployment** (e.g., `https://example.com/app/`): Uses `/app/assets/images/jade-avatar.png`

This is handled by the `getAvatarUrl()` function which checks for a `<base>` tag in the HTML.

### Verifying Avatar Loads

**Via Browser Console:**

1. Open DevTools Console (F12)
2. Look for: `✅ JadeAssist avatar loaded successfully`
3. If failed: `⚠️ JadeAssist avatar failed to load. Check that the image exists at: [url]`

**Via Network Tab:**

1. Open DevTools Network tab (F12 → Network)
2. Filter by "Img" or "jade-avatar"
3. Refresh the page
4. Look for the `jade-avatar.png` request
5. Status should be `200 OK` (green)
6. If `404 Not Found` (red), the file doesn't exist at that path

**Direct URL Test:**

1. Navigate to: `https://your-domain.com/assets/images/jade-avatar.png`
2. The image should display directly in your browser
3. If you see a 404 error page, the file is missing

## Widget Positioning

### Desktop Positioning

The widget is positioned on the **left side** of the screen, aligned with the back-to-top button's vertical position:

```css
/* Widget (left side) */
bottom: 5rem; /* 80px from bottom */
left: 1.5rem; /* 24px from left */

/* Back-to-top button (right side) - for reference */
bottom: 5rem; /* 80px from bottom */
right: 1.5rem; /* 24px from right */
```

### Mobile Positioning

On screens narrower than 768px, both buttons adjust:

```css
/* Widget (left side) */
bottom: 4.5rem; /* 72px from bottom */
left: 1rem; /* 16px from left */

/* Back-to-top button (right side) - for reference */
bottom: 4.5rem; /* 72px from bottom */
right: 1rem; /* 16px from right */
```

### How Positioning Works

The positioning is now controlled through the widget's public API configuration:

**Desktop positioning:**

```javascript
offsetBottom: '5rem',  // Distance from bottom
offsetLeft: '1.5rem',  // Distance from left
```

**Mobile positioning:**

```javascript
offsetBottomMobile: '4.5rem',  // Distance from bottom on mobile
offsetLeftMobile: '1rem',       // Distance from left on mobile
```

The widget automatically handles responsive positioning based on these configuration options. No CSS overrides or shadow DOM manipulation is required.

### Adjusting Position

To change the widget position:

1. **Edit the init script:**
   - `public/assets/js/jadeassist-init.v2.js`

2. **Update the positioning configuration:**

   ```javascript
   window.JadeWidget.init({
     // Desktop positioning
     offsetBottom: 'YOUR_VALUE',
     offsetLeft: 'YOUR_VALUE',

     // Mobile positioning
     offsetBottomMobile: 'YOUR_VALUE',
     offsetLeftMobile: 'YOUR_VALUE',

     // Other options...
   });
   ```

3. **Update the teaser positioning** in the CSS to appear above the widget:
   - Teaser should be widget bottom + 3rem spacing
   - Example: Widget at 5rem → Teaser at 8rem

### Teaser Bubble

The teaser bubble appears above the widget with these positions:

**Desktop:**

```css
bottom: 8rem; /* Widget at 5rem + 3rem spacing */
left: 1.5rem;
```

**Mobile:**

```css
bottom: 7.5rem; /* Widget at 4.5rem + 3rem spacing */
left: 1rem;
```

## Widget Behavior

### Initial State

The widget is **closed by default** when the page loads:

- The launcher button (avatar) is visible
- The chat panel is closed
- A teaser bubble appears after 500 ms (if not dismissed within the last day), or immediately after the user scrolls 25% down the page — whichever is first

This is enforced defensively with:

```javascript
setTimeout(() => {
  if (window.JadeWidget && typeof window.JadeWidget.close === 'function') {
    window.JadeWidget.close();
  }
}, 100);
```

### Opening the Widget

Users can open the widget by:

1. **Clicking the launcher button** (avatar icon)
2. **Clicking the teaser bubble** (opens chat and dismisses the teaser)
3. **Pressing Enter or Space** while the teaser bubble is focused

### Teaser Behavior

The teaser bubble:

- Shows after 500 ms if not recently dismissed **or** when the user scrolls 25% down the page (whichever comes first)
- Can be dismissed by clicking the "×" button (doesn't open chat)
- Can be clicked to open the chat (opens chat and dismisses teaser)
- Supports keyboard navigation: **Enter/Space** opens chat, **Escape** dismisses
- Emits analytics custom events (see [Analytics Integration](#analytics-integration))
- **Auto-dismisses after 10 s** if the user does not interact with it
- **Dismissal persists for 1 day** in `localStorage` — teaser will not reappear for 24 h after it is dismissed or after the chat is opened
- Disappears immediately when the chat opens (via any path: teaser click, widget icon click, or programmatic open)
- Mobile-friendly copy (shorter text on screens <768 px)
- Safe-area inset support for iOS notch/Dynamic Island devices

#### How dismissal works

When the user:

1. **Clicks the teaser** — teaser is dismissed and chat opens
2. **Clicks the widget launcher icon** — teaser is dismissed immediately (handled by `openChat()` and a background watcher that polls for chat open state every 500 ms)
3. **Presses Escape on the teaser** — teaser is dismissed, chat stays closed
4. **Clicks the "×" close button** — teaser is dismissed, chat stays closed
5. **Waits 10 s without interacting** — teaser auto-dismisses

All dismissal paths store a timestamp in `localStorage` under the key `jadeassist-teaser-dismissed`. The teaser is not shown again until that timestamp is more than 24 h old.

#### Testing teaser behavior

To reset the dismissal state and see the teaser again:

```javascript
// In browser DevTools console:
localStorage.removeItem('jadeassist-teaser-dismissed');
location.reload();
```

To test a specific A/B variant:

```javascript
// Set variant (A, B, or C)
localStorage.setItem('jadeassist-teaser-variant', 'B');
localStorage.removeItem('jadeassist-teaser-dismissed');
location.reload();
```

## Widget Library (Self-Hosted)

The widget bundle is self-hosted to avoid browser Tracking Prevention (Edge, Brave, Firefox, Safari blocking `cdn.jsdelivr.net` from accessing storage, which prevented widget initialization):

```html
<script src="/assets/js/vendor/jade-widget.js" defer></script>
```

The vendor file lives at `public/assets/js/vendor/jade-widget.js` and is built from the [JadeAssist repository](https://github.com/rhysllwydlewis/JadeAssist).

**Why self-hosted instead of CDN?**

- Avoids browser Tracking Prevention blocking CDN storage access
- Ensures consistent behavior across all deployments
- No dependency on jsDelivr uptime or caching

**To update the widget library:**

1. Build the new version from [rhysllwydlewis/JadeAssist](https://github.com/rhysllwydlewis/JadeAssist) (`packages/widget`)
2. Copy `packages/widget/dist/jade-widget.js` to `public/assets/js/vendor/jade-widget.js`
3. Run tests: `npm run test:integration`
4. Verify the widget works correctly on dev/staging

## Troubleshooting

### Widget Not Appearing

1. **Check vendor script is loaded:**
   - Open Console, look for `[JadeAssist] Widget not yet available, will retry…`
   - Check Network tab for `/assets/js/vendor/jade-widget.js`
   - Verify status is 200 OK

2. **Check for errors:**
   - Look for `Failed to initialize JadeAssist widget:` in Console
   - Check for JavaScript errors that might block execution

3. **Check widget element:**
   - Look for `.jade-widget-root` in the DOM
   - Use DevTools Elements panel to inspect

### Avatar Not Loading

1. **Check console diagnostics:**
   - Look for avatar URL log message
   - Check for `⚠️ avatar failed to load` warning

2. **Verify file exists:**
   - Check `public/assets/images/jade-avatar.png` exists
   - Navigate to the URL directly in browser

3. **Check network request:**
   - Open Network tab
   - Look for jade-avatar.png request
   - Verify 200 status (not 404)

### Widget Overlapping Other Elements

1. **Check z-index:**
   - Widget uses `z-index: 999`
   - Teaser uses `z-index: 998`
   - Ensure other floating elements use lower z-index values

2. **Adjust positioning:**
   - Edit the CSS overrides in init scripts
   - Test on both desktop and mobile breakpoints

### Chat Opens Automatically

If the chat opens on page load unexpectedly:

1. **Check for auto-open config:**
   - Review the `init()` configuration
   - Ensure no `autoOpen: true` is set

2. **Verify defensive close:**
   - Check the setTimeout with `JadeWidget.close()` exists
   - Increase timeout if needed (currently 100ms)

## Testing

### Manual Testing

1. **Test on a live page:**

   ```bash
   # Start the server
   npm start

   # Open in browser
   http://localhost:3000/
   ```

2. **Check these behaviors:**
   - [ ] Widget launcher appears (left side, aligned with back-to-top)
   - [ ] Avatar image loads successfully
   - [ ] Chat is closed initially
   - [ ] Teaser appears after ~500ms (if not dismissed recently)
   - [ ] Teaser has EventFlow brand styling (teal left border, matching font)
   - [ ] Teaser auto-dismisses after ~10 s
   - [ ] Clicking launcher opens chat **and teaser disappears**
   - [ ] Clicking teaser opens chat
   - [ ] Clicking teaser "×" dismisses without opening chat
   - [ ] After dismissal, teaser does not reappear for 24 h
   - [ ] Tab to teaser → Enter/Space opens chat
   - [ ] Tab to teaser → Escape dismisses
   - [ ] Tab to teaser → Tab again → close button focused → Enter dismisses

3. **Test on mobile:**
   - Use DevTools responsive mode (F12 → Toggle device toolbar)
   - Set viewport to 375px width (iPhone size)
   - Verify positioning adjusts correctly

### Automated Testing

Run the integration tests:

```bash
npm run test:integration
```

This verifies:

- Self-hosted vendor script is used (no CDN references)
- All HTML pages reference `jadeassist-init.v2.js` (not the legacy script)
- `jadeassist-init.v2.js` contains required features: teaser constants, A/B variants, keyboard accessibility keys, analytics events, safe-area CSS, scroll trigger, avatar URL resolution, and double-init guard

## Configuration Reference

### JadeWidget.init() Options

```javascript
{
  apiBaseUrl: 'https://jadeassistbackend-production.up.railway.app', // JadeAssist backend URL
  primaryColor: '#00B2A9',           // Main brand color
  accentColor: '#008C85',            // Accent/hover color
  assistantName: 'Jade',             // Name shown in chat
  greetingText: "Hi! I'm Jade...",   // Greeting message
  greetingTooltipText: '',             // Disabled — custom teaser bubble used instead
  avatarUrl: '/assets/images/...',   // Avatar image path
  offsetBottom: '5rem',              // Distance from bottom (desktop)
  offsetLeft: '1.5rem',              // Distance from left (desktop)
  offsetBottomMobile: '4.5rem',      // Distance from bottom (mobile)
  offsetLeftMobile: '1rem',          // Distance from left (mobile)
  scale: 0.85,                       // Size scale (0.85 = 15% smaller)
  debug: false,                      // Enable diagnostic logs
}
```

### Key Constants

```javascript
MAX_RETRIES: 50;               // Widget load retry attempts (5 seconds @ 100ms interval)
RETRY_INTERVAL: 100;           // Time between retries (ms)
INIT_DELAY: 2000;              // Delay before first init attempt (ms)
TEASER_DELAY: 500;             // Delay before showing teaser after init (ms)
TEASER_AUTO_DISMISS_MS: 10000; // Auto-dismiss teaser after 10 s of inactivity
TEASER_EXPIRY_DAYS: 1;         // How long dismissal persists (1 day = 24 h)
MOBILE_BREAKPOINT: 768;        // px — switches to mobile teaser copy below this width
```

## Support

For issues with the JadeAssist widget:

1. Check console for diagnostic messages
2. Verify avatar and CDN resources load (Network tab)
3. Review this documentation
4. Check the widget library repository: https://github.com/rhysllwydlewis/JadeAssist

## Analytics Integration

The widget emits custom events that can be tracked:

```javascript
// Listen for teaser clicks
window.addEventListener('jadeassist:teaser-clicked', e => {
  console.log('Teaser clicked:', e.detail);
  // Send to analytics
  gtag('event', 'teaser_click', { timestamp: e.detail.timestamp });
});

// Listen for widget opens
window.addEventListener('jadeassist:widget-opened', e => {
  console.log('Widget opened:', e.detail);
  // Send to analytics
  gtag('event', 'widget_open', { timestamp: e.detail.timestamp });
});

// Listen for teaser dismissals
window.addEventListener('jadeassist:teaser-dismissed', e => {
  console.log('Teaser dismissed:', e.detail);
  // Send to analytics
  gtag('event', 'teaser_dismiss', {
    timestamp: e.detail.timestamp,
    method: e.detail.method,
  });
});
```

### Event Details

- **jadeassist:teaser-clicked**: Fired when user clicks the teaser bubble to open chat
  - `detail.timestamp`: Time of click
  - `detail.source`: Always 'teaser-bubble'

- **jadeassist:widget-opened**: Fired when the chat widget is opened
  - `detail.timestamp`: Time of opening

- **jadeassist:teaser-dismissed**: Fired when teaser is dismissed without opening
  - `detail.timestamp`: Time of dismissal
  - `detail.method`: How it was dismissed (`'close-button'` | `'keyboard-escape'` | `'auto-dismiss'`)

## A/B Testing

Test different teaser messages:

### Setting Test Variants

The widget supports three teaser message variants (A, B, C). To test different variants:

```javascript
// Set variant in console
localStorage.setItem('jadeassist-teaser-variant', 'B');
location.reload();

// Check current variant
localStorage.getItem('jadeassist-teaser-variant'); // 'A', 'B', or 'C'

// Clear variant (revert to default 'A')
localStorage.removeItem('jadeassist-teaser-variant');
location.reload();
```

### Available Variants

**Variant A (Default):**

- Desktop: "Hi, I'm Jade — want help finding venues and trusted suppliers?"
- Mobile: "Need help finding venues? 👋"

**Variant B:**

- Desktop: "Planning an event? Let me help you find the perfect suppliers! 🎉"
- Mobile: "Planning an event? 🎉"

**Variant C:**

- Desktop: "Find trusted event suppliers in minutes ⚡"
- Mobile: "Find suppliers fast ⚡"

### Testing Workflow

1. **Set variant**: Use localStorage to select variant (A, B, or C)
2. **Track events**: Use analytics integration to measure conversion rates
3. **Compare metrics**:
   - Teaser click-through rate
   - Widget engagement rate
   - Time to first interaction
4. **Choose winner**: Implement the best-performing variant as the new default

### Implementation

To change the default variant or add new variants, edit the `TEASER_VARIANTS` constant in the initialization scripts (`jadeassist-init.v2.js` and `jadeassist-init.js`).

---

## Mobile QA Checklist

Use this checklist after any widget deploy to verify mobile behaviour before signoff.

### Prerequisites

- Device or browser DevTools emulating a mobile viewport (e.g. 375 × 812 — iPhone 14)
- Incognito/private window (clears localStorage dismissal state)
- Production URL: `https://event-flow.co.uk`

---

### 1 — Single widget instance

- [ ] Only **one** floating avatar/launcher appears in the bottom-left corner
- [ ] No duplicate or ghost launcher visible
- [ ] Open DevTools Console — no `[JadeAssist] Widget already initialized` warning on a fresh page load

---

### 2 — Single teaser bubble

- [ ] After ~0.5 s on the homepage a compact teaser bubble appears above the launcher
- [ ] The teaser shows a **non-empty** message (variant A/B/C text)
- [ ] Only **one** teaser is visible — no duplicate or blank white rectangle
- [ ] Teaser close button (✕) is fully visible and tappable (no clipping)
- [ ] Tapping the close button dismisses the teaser with a fade
- [ ] Reloading within 24 h does NOT show the teaser again (localStorage key `jadeassist-teaser-dismissed`)
- [ ] Tapping the teaser body opens the chat **and** removes the teaser

---

### 3 — Teaser mobile layout

- [ ] Teaser width ≤ 260 px (does not span full screen width)
- [ ] Teaser does not cover key page CTAs (e.g. hero CTA on `/`)
- [ ] Teaser sits above the launcher and **above** the bottom nav / safe area on iOS/Android
- [ ] Avatar, text and close button are compact but readable
- [ ] No large empty white card dominates the viewport

---

### 4 — Chat panel

- [ ] Tapping the launcher opens the chat panel
- [ ] Chat panel fits within the viewport (no vertical overflow or cut-off)
- [ ] Closing with ✕ button works

---

### 5 — In-chat action menu (⋮)

- [ ] The **three-dots (⋮) menu button** is visible in the chat header on mobile
- [ ] The button has a large enough tap target (≥ 36 × 36 px)
- [ ] Tapping ⋮ opens the menu panel
- [ ] Menu panel is fully visible on screen (bottom-sheet style on mobile)
- [ ] All four actions are accessible by touch:
  - [ ] **Export chat** — tapping downloads a `.txt` file of the conversation
  - [ ] **Mute / Unmute sounds** — label toggles between "Mute sounds" and "Unmute sounds"
  - [ ] **Notification volume** slider — draggable, full width
  - [ ] **Clear chat** — tapping prompts confirmation then resets messages
- [ ] Closing the chat closes the menu panel

---

### 6 — Chat header layout

- [ ] Assistant name (`Jade`) is visible and truncates before menu/close buttons disappear
- [ ] No header overflow causes menu button (⋮) to be pushed off screen
- [ ] All header controls (⋮, −, ✕) remain visible at 320 px viewport width

---

### 7 — No legacy conflicts

- [ ] DevTools Network tab shows **only** `/assets/js/vendor/jade-widget.js` and `/assets/js/jadeassist-init.v2.js` loading for the chat widget
- [ ] `live-chat.js` and `jadeassist-init.js` (legacy) are **NOT** loaded
- [ ] Only one `.jade-widget-root` element in the DOM (inspect Elements panel)

---

### Debug helpers

| Task | Command |
|------|---------|
| Enable debug logging | Append `?jade-debug` to any page URL |
| Force teaser to show | `localStorage.removeItem('jadeassist-teaser-dismissed'); location.reload();` |
| Set teaser variant | `localStorage.setItem('jadeassist-teaser-variant', 'B'); location.reload();` |
| Inspect widget state | `window.JadeWidget.instance.state` in console |
| Check open state | `window.JadeWidget.isOpen()` |
