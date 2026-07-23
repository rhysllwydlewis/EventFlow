# PR #1394 follow-up

This branch corrects the acceptance gaps identified after PR #1394 reached production.

- The close bubble is now a true visual counterpart to the notification bubble.
- The close control and Jade launcher share a synchronized movement timeline.
- The effective close target remains at least 44 pixels after widget scaling.
- Notification-image failure has a styled, legible fallback.
- Dismissal defaults to 24 hours instead of an unreviewed 30-day lockout and remains configurable.
- Production injection and cache versioning are deterministic and idempotent.
- Desktop and mobile Chromium exercise geometry, accessibility, fallback and dismissal expiry through a dedicated harness.
