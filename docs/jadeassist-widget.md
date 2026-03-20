# JadeAssist Widget Documentation

This document describes how the JadeAssist chat widget is configured and customized for EventFlow.

## Overview

The JadeAssist widget is a chat assistant that helps users find venues and suppliers. It's positioned on the left side of the screen, aligned vertically with the back-to-top button (which is on the right side).

## Configuration Files

- **`public/assets/js/jadeassist-init.v2.js`** — **Current version** used across all pages. Features teaser bubble with A/B testing, full keyboard accessibility, analytics events, safe-area inset support, and debug diagnostics.
- **`public/assets/js/jadeassist-init.js`** — Legacy version kept for reference. Not loaded by any HTML page.

## Debug Mode

Append `?jade-debug` to any page URL to enable diagnostic logs in the browser console. This works in **all environments** (production, staging, localhost).

### What debug mode logs

- Init config summary (colors, avatar URL, positioning offsets, scale)
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
- Auto-dismisses after 15 s
- Dismissal state persists for 1 day in localStorage
- Mobile-friendly copy (shorter text on screens <768 px)
- Safe-area inset support for iOS notch/Dynamic Island devices

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
   - [ ] Clicking launcher opens chat
   - [ ] Clicking teaser opens chat
   - [ ] Clicking teaser "×" dismisses without opening chat
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
MAX_RETRIES: 50; // Widget load retry attempts (5 seconds @ 100ms interval)
RETRY_INTERVAL: 100; // Time between retries (ms)
INIT_DELAY: 2000; // Delay before first init attempt (ms)
TEASER_DELAY: 500; // Delay before showing teaser after init (ms)
TEASER_EXPIRY_DAYS: 1; // How long dismissal persists
MOBILE_BREAKPOINT: 768; // px — switches to mobile teaser copy below this width
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
