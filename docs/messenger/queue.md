# Messenger BullMQ notification queue

## Architecture

```text
HTTP send message
  |-- realtime socket emit (request path)
  `-- persist fan-out marker, then enqueue a deterministic notification job
       `-- notification worker
            |-- idempotent in-app notification fan-out
            `-- enqueue deterministic per-recipient email jobs
                 `-- email worker (attempts: 5, exponential backoff)
```

## Runtime behaviour

- Queues: `notifications`, `email`.
- Redis URL: `REDIS_URL` (development default: `redis://127.0.0.1:6379`).
- Queue namespace: `EVENTFLOW_QUEUE_NAMESPACE` (backwards-compatible default: `bull`). Set a
  unique value for new, independently deployed environments that share Redis. Do not change
  the namespace of an active deployment until its old queues have been drained.
- Job IDs are deterministic SHA-256-derived values that use only BullMQ-safe characters.
- If `REDIS_URL` is unset outside production, the queue uses an in-process synchronous
  fallback. This is for development only.
- Production workers require `MONGODB_URI`, `REDIS_URL`, an HTTPS `BASE_URL`, and a working
  `POSTMARK_API_KEY`. Message email cannot silently fall back to the local outbox.
- A worker heartbeat is published only after both queue consumers and the initial durable
  recovery scan are ready. The web `/api/ready` endpoint requires a recent heartbeat.

## Running workers locally

```bash
npm run worker
```

## Running the worker in production

- Run both process types:
  - `web: node server.js`
  - `worker: EVENTFLOW_PROCESS_TYPE=worker node scripts/worker.js`
- Set `MONGODB_URI`, `REDIS_URL`, `POSTMARK_API_KEY`, and HTTPS `BASE_URL` in the worker.
- Do not rely on the in-process fallback in production.
- Preflight (`npm run preflight`) fails when a required production delivery dependency is
  unset. Keep it before the web start command so a misconfigured deployment never becomes
  ready.

### Platform-specific hints

- **Heroku-style dyno platforms**: `Procfile` declares both `web` and `worker` processes.
  Scale the worker dyno to at least one instance.
- **Railway**: deploy the web service with `railway.json`, then deploy a second service from
  the same repository with `railway.worker.json`.
- **Docker Compose**: `docker-compose.yml` includes Redis and a dedicated worker service.

## Queue inspection

Use BullMQ-compatible operational tooling to inspect queue depth, retry or remove failed
email jobs, and confirm that both consumers are active. Failed email jobs are retained for
inspection.

## Failure and recovery model

- Queue enqueue failures do not fail the message-send response. The message's durable fan-out
  marker remains retryable.
- The reconciler reclaims pending, failed, expired, and stale queued markers. Exhausted
  notification jobs are removed so their deterministic ID can be re-added safely.
- In-app notification inserts are idempotent per message and recipient.
- Email jobs retry five times and failed jobs remain available for operational inspection or
  retry. Fully durable, provider-level exactly-once email is not claimed.
- Account email opt-outs (`notify_account=false`) are honoured by the email worker.
- Configure Redis persistence and a non-evicting policy for queue keys. Stale Mongo markers
  provide recovery if a queued Redis job is nevertheless lost.
