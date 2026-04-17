# Messenger Step 3: BullMQ Notification Queue

## Architecture

```text
HTTP send message
  ├─ realtime socket emit (request path)
  └─ enqueue notifications job (message:<messageId>)
       └─ notification worker
            ├─ in-app notification fanout
            └─ enqueue email jobs (message:<messageId>:recipient:<id>)
                 └─ email worker (attempts:5, exponential backoff)
```

## Runtime behavior

- Queues: `notifications`, `email`
- Redis URL: `REDIS_URL` (default: `redis://127.0.0.1:6379`)
- If `REDIS_URL` is unset and `NODE_ENV !== production`, queue uses an in-process synchronous fallback (no external infra required).

## Running workers locally

```bash
npm run worker
```

## Queue inspection

- BullMQ CLI / optional Bull Board can be used to inspect queue depth and failed jobs.

## Failure modes

- Queue enqueue failures do not fail message send responses.
- Job IDs include `messageId` to prevent duplicate fanout on retries.
