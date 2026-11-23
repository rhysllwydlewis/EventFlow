# Ops Assistant request signing

The Ops Assistant routine calls the read-only `/internal/ops-bot/*` API. Every
request is signed with a shared secret. (The data-audit endpoints are described in
[OPS_ASSISTANT_AUDITS.md](OPS_ASSISTANT_AUDITS.md).) This page is the reference for what is
signed, and the checklist for the two failures the routine has reported:

- `401 {"error":"Invalid Ops Assistant signature"}` (issues #1679, #1757)
- `403` on `CONNECT event-flow.co.uk:443` (issues #1804, #1826) — a different
  problem, covered at the end.

## What the server checks

`middleware/opsBotHmac.js` accepts a request only if all of these hold:

| Check                                                                                  | Failure                                                     |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `OPS_ASSISTANT_ENABLED=true` on the production service                                 | `503 Ops Assistant is disabled`                             |
| `EVENTFLOW_OPS_BOT_HMAC_SECRET` is set and at least 32 characters                      | `503 Ops Assistant secret is not configured`                |
| `x-eventflow-bot-timestamp` is milliseconds since the epoch, within 5 minutes of now   | `401 Ops Assistant request timestamp is invalid or expired` |
| `x-eventflow-bot-signature` matches the signature below (`sha256=` prefix is optional) | `401 Invalid Ops Assistant signature`                       |

The signature is hex HMAC-SHA256, keyed with the secret, over this exact string:

```
<timestamp>.<METHOD>.<originalUrl>.<body>
```

- `timestamp`: the same value sent in `x-eventflow-bot-timestamp`.
- `METHOD`: upper case, for example `GET`.
- `originalUrl`: the request path **including any query string**, exactly as the
  server receives it, for example `/internal/ops-bot/content-review-tasks` or
  `/internal/ops-bot/audit-log?limit=20`. It is not path-only: a client that
  signs the bare path but sends `?limit=20` fails with a signature error.
- `body`: `JSON.stringify` of the parsed request body. For a request with no body
  this is `{}`, not an empty string.

## Why a 401 is hard to read

The HTTP response is deliberately generic, so an unauthenticated caller learns
nothing about why it failed. The production service therefore logs the reason
instead, as a `[OPS-BOT] Rejected request` warning:

| Field                 | What it tells you                                                              |
| --------------------- | ------------------------------------------------------------------------------ |
| `reason`              | `signature_mismatch` or `timestamp_invalid_or_expired`                         |
| `method`, `path`      | What the server signed. Compare with what the client signed.                   |
| `hasQuery`            | `true` means the server signed a query string. The query itself is not logged. |
| `signatureHeader`     | `sha256-prefixed`, `bare` or `missing`                                         |
| `signatureWellFormed` | `false` means the header is not 64 hex characters (truncated or wrong format)  |
| `bodyBytes`           | Length of the body the server signed. `2` means `{}`.                          |
| `skewMs`              | Server clock minus the client's timestamp. Large values mean clock drift.      |
| `secretFingerprint`   | First 8 hex characters of SHA-256 of the server's secret (see below)           |

Nothing in the log can be used to forge a signature: it never contains the
secret, the expected signature or the received signature.

## Is the secret the same on both sides?

This is the usual cause when the signing scheme is right and every request still
returns 401. Print the fingerprint wherever the secret is held and compare:

```bash
EVENTFLOW_OPS_BOT_HMAC_SECRET=... node scripts/ops-bot-secret-fingerprint.js
```

The script has no dependencies, so it runs in an environment with no
`node_modules`. It prints `EVENTFLOW_OPS_BOT_HMAC_SECRET fingerprint: xxxxxxxx`
and never the secret. Compare it with the `secretFingerprint` in the production
`[OPS-BOT] Rejected request` log line. If they differ, re-sync the secret in the
routine's environment (or on the production service) and the 401s stop.

## Triage

1. Find the `[OPS-BOT] Rejected request` line for the failing call.
2. `secretFingerprint` differs from the routine's: re-sync the secret.
3. `hasQuery` is `true` and the client signed the bare path: sign `originalUrl`
   including the query string.
4. `bodyBytes` is not what the client signed (for example the client signed an empty
   string for a GET): sign `{}`.
5. `signatureWellFormed` is `false` or `signatureHeader` is `missing`: the client is
   sending a truncated or empty signature header.
6. `skewMs` is more than 300000: fix the client clock.

## 403 on `CONNECT event-flow.co.uk:443`

This is not a signing problem. The request never reaches the server: the routine
environment's network policy refuses the connection. Add `event-flow.co.uk` to
that environment's allowed domains. Database-backed audit scripts additionally
need `MONGODB_URI` reachable from the environment; see `AUDIT_REQUIRE_MONGODB`
below.

## Database audit scripts

`scripts/audit-orphaned-supplier-data.js`,
`scripts/audit-supplier-locations.js` and
`scripts/audit-marketplace-listing-locations.js` fall back to local file storage
when MongoDB is unreachable, then report "0 findings". That is not a clean result.
Set `AUDIT_REQUIRE_MONGODB=true` in an environment that needs a real answer (or pass
`--require-mongodb`): the scripts then refuse to run against anything but a
healthy MongoDB connection and exit non-zero instead.
