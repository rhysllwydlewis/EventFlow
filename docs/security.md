# Security: Bot-Probing & API Documentation Hardening

## Why bots scan for Swagger / OpenAPI endpoints

Automated internet scanners (security researchers, vulnerability bots, and malicious actors) routinely probe thousands of well-known paths on every public-facing server:

- `/api-docs/swagger.json`
- `/api-docs`
- `/swagger`
- `/swagger.json`
- `/openapi.json`

These paths are universally used by popular frameworks (Express + swagger-ui-express, Spring Boot, Django REST Framework, FastAPI, etc.). Finding a live, unauthenticated Swagger UI can let an attacker:

1. **Enumerate every API endpoint** – including internal, admin, or debug routes.
2. **Inspect authentication schemes** – cookie names, token formats, header names.
3. **Identify input shapes** – easier to craft injection payloads.
4. **Trigger "Try it out"** – directly invoke API calls from the docs UI.

Seeing requests to these paths in your logs is **normal background noise on any public site**. The goal of this hardening is to make sure those probes don't yield useful information.

---

## Current protection (as of this PR)

### Disabled in production by default

`/api-docs*`, `/swagger*`, and `/openapi*` all return **HTTP 404** in production unless explicitly re-enabled. The gating logic in `server.js`:

```js
const apiDocsEnabled = process.env.ENABLE_API_DOCS === 'true' || !isProduction;
```

All probe paths are also **rate-limited** (20 requests / 15 minutes per IP) to reduce the impact of automated scans.

Every probe attempt in production is **logged at `warn` level** with method, path, IP, user-agent, and referer — no secrets are logged.

---

## Enabling docs locally (development)

In development (`NODE_ENV` is not `production`), the Swagger UI is served at `/api-docs` automatically. No configuration required.

```bash
# Start dev server
npm run dev
# or
node server.js

# Visit
open http://localhost:3000/api-docs
```

---

## Enabling docs in production safely

Only do this if you genuinely need interactive docs accessible in production (e.g., for an internal developer portal). Use **all three** of the following controls:

### 1. Set the env flag

```bash
ENABLE_API_DOCS=true
```

### 2. Protect with Basic Auth (recommended)

Add an authenticated middleware before the `/api-docs` route. Example with `express-basic-auth`:

```bash
npm install express-basic-auth
```

```js
const basicAuth = require('express-basic-auth');

if (process.env.ENABLE_API_DOCS === 'true') {
  app.use(
    '/api-docs',
    basicAuth({
      users: { [process.env.API_DOCS_USER]: process.env.API_DOCS_PASS },
      challenge: true,
    }),
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      /* ... */
    })
  );
}
```

Set `API_DOCS_USER` and `API_DOCS_PASS` as strong secrets in your deployment environment (Railway / Render / etc.).

### 3. IP allowlist (optional additional layer)

Restrict access to a known VPN or office IP range by adding an allowlist check before the swagger middleware, or configure it at the CDN/load-balancer level (e.g., Cloudflare firewall rules).

---

## "Try it out" in production

Even when docs are enabled in production, the Swagger UI is configured to **disable all submit methods** so users cannot call API endpoints directly from the UI:

```js
swaggerOptions: {
  supportedSubmitMethods: isProduction ? [] : ['get', 'post', 'put', 'patch', 'delete'],
}
```

This means the docs are read-only in production.

---

## What to watch for in logs

Look for `warn` log entries with the label `Swagger/OpenAPI probe path accessed in production (docs disabled)`. A sudden spike of these from a small number of IPs may indicate active reconnaissance. Consider:

- Blocking the offending IP(s) at the CDN/WAF level.
- Enabling Cloudflare Bot Fight Mode or equivalent.
- Reviewing whether the IPs are also hitting other sensitive paths (`/.env`, `/.git`, `/actuator`, `/wp-admin`, etc.).

---

## CORS policy

CORS is configured in `middleware/security.js → configureCORS()`. It **does not use a wildcard `*`** — only origins explicitly listed via `BASE_URL` and `ALLOWED_ORIGINS` environment variables are permitted in production. Requests from unlisted origins in production receive a 403 error.

---

## Rate limiting summary

| Path pattern                            | Limiter             | Window | Max requests |
| --------------------------------------- | ------------------- | ------ | ------------ |
| `/api-docs*`, `/swagger*`, `/openapi*`  | `apiDocsLimiter`    | 15 min | 20           |
| `/api/auth/*`                           | `authLimiter`       | 15 min | 100          |
| `/api/auth/login`, `/api/auth/register` | `strictAuthLimiter` | 15 min | 10           |
| General API                             | `apiLimiter`        | 15 min | 100          |
