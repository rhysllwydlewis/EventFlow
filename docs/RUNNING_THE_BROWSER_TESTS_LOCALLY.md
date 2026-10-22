# Running the browser journeys on your own machine

The "Mongo-backed browser journeys" CI job drives the real site in a real browser against a real
MongoDB. This is how to do the same locally, for the supplier dashboard or any other `@backend`
spec in `e2e/`.

## What you need

- Node (see `.node-version`) and `npm ci`
- MongoDB 7 running as a **replica set** (the app uses transactions)
- Playwright's browsers: `npx playwright install chromium` (add `firefox webkit` for the other engines)
- Redis is optional. Without `REDIS_URL` the app runs with in-memory fallbacks. Set it to a local
  Redis (for example `redis://127.0.0.1:6379`) only if you are testing more than one instance.

## 1. Start MongoDB as a replica set

With a local `mongod`:

```bash
mkdir -p /tmp/ef-mongo
mongod --dbpath /tmp/ef-mongo --port 27017 --bind_ip 127.0.0.1 --replSet rs0 --quiet &
mongosh --quiet --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]})'
```

(or `docker run -d -p 27017:27017 mongo:7 --replSet rs0` and the same `rs.initiate`.)

## 2. Run the journeys

Playwright starts the server itself (`npm start`) with `NODE_ENV=test`, so nothing else is needed:

```bash
export E2E_MODE=full
export JWT_SECRET=backend-e2e-secret-for-github-actions-minimum-32-chars
export MONGODB_URI='mongodb://127.0.0.1:27017/eventflow_e2e?replicaSet=rs0'

npm run test:e2e:backend -- --project=chromium           # every classified journey
npx playwright test e2e/supplier-dashboard-actions.spec.js --project=chromium   # one spec
npx playwright test e2e/supplier-dashboard-actions.spec.js --project=firefox --project=webkit
```

`E2E_MODE=full` is what makes the server accept the test fixtures (`/__e2e/seed`) and skip the rate
limits and the `upgrade-insecure-requests` header, which only the isolated suite does. It must never
be set in production (`NODE_ENV` must also be `test`).

If the server is already running on port 3000 (for example from `npm start` with the same variables),
Playwright reuses it, which is quicker when you are iterating. Restart it after changing server code.

## 3. Test accounts

Each spec seeds its own accounts and removes them afterwards (`e2e/helpers/backend-fixtures.js`): an
approved supplier with a package, a supplier waiting for approval, a customer and an admin. Nothing
needs creating by hand, and no email or payment provider is contacted: mail is written to `/outbox`
and Stripe is never called.

## The real-database Jest tests

The Jest tests that need a real MongoDB (`*-real-mongo.test.js`) run only when asked for:

```bash
MONGO_REPLICA_SET=true MONGODB_URI='mongodb://127.0.0.1:27017/x?replicaSet=rs0' \
  npx jest tests/integration/supplier-enquiries-real-mongo.test.js
```

and the two-instance Socket.IO test needs a real Redis:

```bash
MULTI_INSTANCE_REDIS_URL=redis://127.0.0.1:6379 npx jest tests/integration/websocket-multi-instance.test.js
```

CI runs all of them in the "Mongo Replica Set Transactions" job.

## Tips

- A page that looks unstyled, or `net::ERR_*` errors, in a sandbox with an outbound proxy are usually
  the proxy, not the site: check `getComputedStyle` or `curl` before treating one as a bug.
  Firefox does not use the system certificate store, so a CDN script (FullCalendar) can fail to load
  behind a TLS-intercepting proxy; the calendar journeys need it.
- `npm run check:asset-versions` tells you which pages still point at an old `?v=` of a script or
  stylesheet you changed.
