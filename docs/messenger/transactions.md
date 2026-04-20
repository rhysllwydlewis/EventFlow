# Messenger Step 4: Mongo Transactions

- Feature flag: `MONGO_REPLICA_SET=true`
- Default behavior: **OFF** (non-transactional), with startup warning.
- When enabled, send-message write path runs in `session.withTransaction(...)`:
  1. message insert
  2. conversation `lastMessage` + counters update
  3. `conversation_counters` seq increment in same session
- Retries transaction on:
  - `TransientTransactionError`
  - `UnknownTransactionCommitResult`

## Local replica-set setup

```bash
mongod --replSet rs0 --dbpath <path>
mongosh --eval "rs.initiate()"
```

> Roll out plan: keep flag OFF until staging/prod replica-set migration is complete.

## CI coverage

- The `Mongo Replica Set Transactions` GitHub Actions job runs the replica-set transaction rollback test with:
  - `MONGO_REPLICA_SET=true`
  - `MONGODB_URI=mongodb://127.0.0.1:27017/eventflow?replicaSet=rs0`
- This job is additive; existing non-replica-set test jobs remain unchanged.
