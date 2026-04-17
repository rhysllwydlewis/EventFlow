# Messenger Step 1: Reconciliation FSM

- `ReconciliationFSM` drives client states: `IDLE → CONNECTING → CATCHING_UP → LIVE → DISCONNECTED → RECONNECTING`.
- Client persists `lastSeenSeq` in `localStorage` key `messenger:v4:lastSeenSeq:<conversationId>`.
- On reconnect, app drains `GET /conversations/:id/messages?sinceSeq=N` before replaying queued live events.
- Incoming dedupe uses `seq` first, then `clientMessageId` for optimistic reconciliation.
- Rendered incoming messages auto-batch `POST /delivered` (500ms, max 50 IDs), and visible/focused conversations advance `POST /read { upToSeq }` (750ms debounce, monotonic only).
- Header shows **Reconnecting…** pill until FSM returns `LIVE`.
