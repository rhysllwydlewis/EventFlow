# WebSocket Client Audit (Effort 6 / Part B5)

This document tracks every consumer of `WebSocketClient` (see
`public/assets/js/websocket-client.js`) on the frontend, the lifecycle
callbacks it wires, and the UX state it mutates when the connection
transitions.

Every consumer should follow the A3 rules:

- `onConnect({ isReconnect })` — silent on first connect, reconnect toast
  only on subsequent reconnects.
- `onDisconnect(reason)` — warning toast throttled to one per ~10 seconds
  so a flappy connection does not spam.
- `onReconnect(attempt)` (optional) — for consumers that need the attempt
  number; reconnect toasts are handled via `onConnect({ isReconnect })` in
  most cases.

All lifecycle toasts must route through `NotificationDispatcher` (see B1)
so the rest of the stack is forbidden by the `no-direct-notifications`
ESLint rule.

## Consumers

| File                                                  | Handlers wired                                                             | State mutated on disconnect                   | Lifecycle UX? |
| ----------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------- | ------------- |
| `public/assets/js/pages/dashboard-supplier-module.js` | `onConnect`, `onDisconnect`, `onNotification` (enquiry/profile-view stats) | Marks dashboard as stale via disconnect toast | ✅ Full (A3)  |
| `public/assets/js/pages/home-init.js`                 | `onConnect`, `onDisconnect`, `onNotification` (notification-badge counter) | Disconnect toast only; badge state untouched  | ✅ Full (B5)  |

## Server-side awareness

The server-side `NotificationService` currently broadcasts new notifications
on the `notification` event. It does not emit presence-style "gone offline"
events — the web sockets that present this information to the client today
are dashboard updates (`enquiry_received`, `profile_view`) and notification
fan-out. A future presence protocol should broadcast `user:offline` /
`user:online` events; the existing socket handshake already has the
information required (`socket.user.id` on authenticated sockets).

## Test coverage

- `tests/unit/websocket-client-lifecycle.test.js` — unit test that mocks
  `socket.io` and asserts the sequence `connect → disconnect → connect`
  produces `{ isReconnect: false }` on first connect and `{ isReconnect: true }`
  on the second, plus that `onDisconnect(reason)` is called exactly once
  with the reason string.
- `tests/integration/dashboard-websocket-integration.test.js` — asserts that
  the dashboard-supplier page wires the expected `onDisconnect` state
  (retrying message) and that the `isReconnect` flag flows through the
  reconnect path.

## Known gaps

- **Presence events** (see "Server-side awareness" above) are out of scope
  for the notification-audit PR and tracked in a follow-up.
- The throttling (10s) is implemented per-consumer rather than centrally in
  `WebSocketClient` to keep this change minimal; centralising it is a safe
  follow-up because the dispatch path is already in one place
  (`NotificationDispatcher`).
