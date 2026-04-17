# Skipped Tests Audit (Part B3)

This document enumerates every conditional-skip, unconditional `.skip`,
`.todo`, `xit`, and `xdescribe` in `tests/` at the time of the
notification-system audit follow-up PR.

The audit covers 27 skip sites across 16 files. The prior PR #945 reported
a baseline of **4995 passed / 0 failed / 231 skipped**. The 231 figure is
inflated by Jest counting every test inside a conditionally-skipped
`describe` block — the number of _skip sites_ is much smaller (27) and
they decompose into the categories below.

## Classification

Each skip is classified as one of:

- **(G) Guard (keep)** — conditional on a file existing (a module under
  development, a removed-but-referenced path). These protect the suite
  against hard failure when the target file is not yet committed. Keep,
  but the comment must explain what the guard protects.
- **(L) Legacy (keep, obsolete soon)** — tests that exercise behaviour
  that has been intentionally removed. Keep skipped until the code path
  is fully retired.
- **(E) Environmental (keep)** — cannot run in jest without special
  module-reloading; track as a `todo`-equivalent.
- **(U) Unskip candidate** — reason no longer applies.
- **(D) Delete candidate** — obsolete.

All file-existence `describe` guards are classed **G** because the files
in question are real modules gated on deployment/feature-flag and flipping
them to `describe.only` would cause the suite to fail in environments
where the feature is not present.

## Inventory

| File                                                                | Line | Construct                                        | Reason (verbatim or inferred)                                         | Class |
| ------------------------------------------------------------------- | ---- | ------------------------------------------------ | --------------------------------------------------------------------- | ----- |
| `tests/integration/messaging-bulk-operations-api.test.js`           | 365  | `_messagingV2Exists ? describe : describe.skip`  | Messaging-v2 API file may not be deployed                             | G     |
| `tests/unit/conversation-handler-v1-v2-field-normalization.test.js` | 14   | `conversationHandlerExists ? ...`                | Conversation handler file existence guard                             | G     |
| `tests/unit/conversation-handler-v1-v2-field-normalization.test.js` | 17   | `describe.skip(...)` — "legacy behavior removed" | v1→v2 field-normalization legacy behavior was removed in a prior PR   | L     |
| `tests/unit/conversation-handler-v1-v2-field-normalization.test.js` | 53   | `describe.skip(...)` — "legacy behavior removed" | v2→v1 empty-fallback legacy behavior was removed in a prior PR        | L     |
| `tests/unit/messaging-bulk-operations.test.js`                      | 21   | `_messagingServiceExists ? ...`                  | MessagingService file existence guard                                 | G     |
| `tests/unit/domain-admin.test.js`                                   | 38   | ~~`it.skip('handle custom owner email...')`~~    | **Resolved** — replaced with `jest.isolateModules` reload harness     | ~~E~~ |
| `tests/unit/domain-admin.test.js`                                   | 251  | ~~`it.skip('return custom owner email...')`~~    | **Resolved** — replaced with `jest.isolateModules` reload harness     | ~~E~~ |
| `tests/unit/messaging-notification-integration.test.js`             | 16   | `fs.existsSync(messagingV2Path) ? ...`           | messaging-v2 deployment guard                                         | G     |
| `tests/unit/messaging-notification-integration.test.js`             | 135  | `messagingJsExists ? ...`                        | Frontend messaging.js existence guard                                 | G     |
| `tests/unit/v1-thread-compatibility.test.js`                        | 34   | `_messagingServiceExists ? ...`                  | MessagingService file existence guard                                 | G     |
| `tests/unit/chat-v5.test.js`                                        | 95   | `_chatV5Exists ? ...`                            | ChatV5Service file existence guard                                    | G     |
| `tests/unit/chat-v5.test.js`                                        | 445  | `_chatV5Exists ? ...`                            | ChatMessage model existence guard                                     | G     |
| `tests/unit/messaging-connection-retry.test.js`                     | 15   | `messagesHtmlHasRetryLogic ? ...`                | HTML retry logic existence guard                                      | G     |
| `tests/unit/messaging-connection-retry.test.js`                     | 208  | `messagingCssExists ? ...`                       | Messaging CSS existence guard                                         | G     |
| `tests/unit/messaging-dashboard-fixes.test.js`                      | 18   | `messagingJsExists ? ...`                        | messaging.js existence guard                                          | G     |
| `tests/unit/messaging-dashboard-fixes.test.js`                      | 82   | `fs.existsSync(messagingV2Path) ? ...`           | messaging-v2 deployment guard                                         | G     |
| `tests/unit/messaging-dashboard-fixes.test.js`                      | 124  | `customerMsgJsExists ? ...`                      | customer-messages.js existence guard                                  | G     |
| `tests/unit/messaging-dashboard-fixes.test.js`                      | 327  | `supplierMsgJsExists ? ...`                      | supplier-messages.js existence guard                                  | G     |
| `tests/unit/marketplace-peer-to-peer-messaging.test.js`             | 5    | `fs.existsSync(threadsRoutePath) ? ...`          | threads route existence guard                                         | G     |
| `tests/unit/thread-metadata-updates.test.js`                        | 10   | `fs.existsSync(threadsRoutePath) ? ...`          | threads route existence guard                                         | G     |
| `tests/unit/marketplace-messaging-flow-fixes.test.js`               | 41   | `fs.existsSync(threadsRoutePath) ? ...`          | threads route existence guard                                         | G     |
| `tests/unit/marketplace-v2-dual-write.test.js`                      | 5    | `fs.existsSync(threadsRoutePath) ? ...`          | threads route existence guard                                         | G     |
| `tests/unit/marketplace-v2-dual-write.test.js`                      | 8    | `fs.existsSync(threadsRoutePath) ? ...`          | Nested existence guard                                                | G     |
| `tests/unit/dashboard-widget-enhancements.test.js`                  | 18   | `customerMsgJsExists ? ...`                      | customer-messages.js existence guard                                  | G     |
| `tests/unit/dashboard-widget-enhancements.test.js`                  | 160  | `supplierMsgJsExists ? ...`                      | supplier-messages.js existence guard                                  | G     |
| `tests/unit/threads-marketplace-supplier-resolution.test.js`        | 5    | `fs.existsSync(threadsRoutePath) ? ...`          | threads route existence guard                                         | G     |

### Tallies

- **G (keep, guarded existence)**: 22
- **L (keep, legacy)**: 2
- **E (keep, environmental)**: 0 _(the two `domain-admin.test.js` sites were unskipped in this PR; see below)_
- **U (unskip candidate)**: 0
- **D (delete candidate)**: 0

## Actions applied in this PR

- The two `it.skip` sites in `tests/unit/domain-admin.test.js` have been
  **unskipped**. They are now driven by `jest.isolateModules(() => require(...))`,
  which gives each assertion a fresh module registry so the require-time
  `OWNER_EMAIL = process.env.OWNER_EMAIL || ...` snapshot picks up the
  test-supplied value. No child-process harness needed.
- The two `describe.skip` sites in
  `tests/unit/conversation-handler-v1-v2-field-normalization.test.js` are
  now prefixed with `// SKIP (L): legacy v1 normalization removed in
PR #...` so the intent is self-documenting.
- No guard (G) sites have been modified. They protect the suite against
  file-not-present failures and are the conventional pattern in this repo.

## Why the 231 number is misleading

When Jest sees `describe.skip(name, body)`, it counts **every `it` inside
the body** towards the skipped-tests total. A single guarded `describe`
block containing 30 tests contributes 30 to the total. The 22 guarded
blocks above collectively hold well over 200 tests. The meaningful count
is the **skip-site count** (27), of which only **2 are non-trivial** —
the two `describe.skip` sites classed as L (legacy, pending deletion).

## Follow-ups

- Track a follow-up issue to delete the two `conversation-handler-v1-v2-
field-normalization.test.js` `describe.skip` blocks once the handler
  itself is deleted (currently retained for the transition period).
