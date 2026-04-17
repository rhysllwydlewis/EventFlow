# Messenger Step 5: Threads, Group UI, Virtualization

- Message send payload now carries `replyToMessageId` (additive).
- Backend stores `replyToMessageId` and returns denormalized `replyTo` preview payload.
- Bubble reply preview is clickable: scrolls to and highlights original message.
- Group UI updates:
  - sender metadata grouped for consecutive messages within 5 minutes
  - participant drawer with online/active state
  - distinct styling for system messages
- `VirtualList` windowing keeps rendered message window bounded (default max 80 nodes).
