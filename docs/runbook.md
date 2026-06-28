# Health-Chain Incident Response Runbook

This runbook covers production failure modes for the Health-Chain Stellar platform. Given the system handles live blood delivery, follow these procedures promptly.

---

## 1. Backend Down

### Detection signals
- `/health` endpoint returns non-2xx or times out.
- Frontend shows "Failed to fetch" errors across all pages.
- Uptime monitor / Grafana dashboard shows HTTP 5xx spike.

### Impact
All API-dependent features unavailable: orders, dispatch, donor flows, admin console.

### Recovery steps
1. SSH into the server and check the process: `pm2 status` or `systemctl status health-chain-api`.
2. Read recent logs: `pm2 logs health-chain-api --lines 200` or `journalctl -u health-chain-api -n 200`.
3. If OOM or crash loop: `pm2 restart health-chain-api`.
4. If the latest deploy is suspect: roll back with `git checkout <previous-tag> && npm run build && pm2 restart`.
5. Confirm recovery by hitting `GET /health` — expect `{ "status": "ok" }`.

---

## 2. Redis Outage

### Detection signals
- BullMQ job queues stall; no workers picking up jobs.
- Backend logs show `ECONNREFUSED` to Redis host.
- Metrics show queue depth growing with zero throughput.

### Impact
Background jobs pause: SMS notifications, saga step processing, WebSocket broadcast relay.  
Real-time features degrade; synchronous API calls still work if Redis is only used for queues.

### Recovery steps
1. Check Redis: `redis-cli -h <host> ping` — expect `PONG`.
2. Restart Redis if self-hosted: `systemctl restart redis`.
3. After Redis is healthy, BullMQ workers reconnect automatically.
4. To drain and replay failed jobs, open the Bull Board dashboard (or run):
   ```bash
   # List failed jobs
   redis-cli -h <host> LRANGE bull:<queue-name>:failed 0 -1
   # Retry all failed jobs via BullMQ API or Bull Board UI
   ```
5. Monitor queue depth in Grafana until it returns to baseline.

---

## 3. PostgreSQL Outage

### Detection signals
- API returns 500 with `connection refused` or `too many connections` in logs.
- Grafana shows DB connection pool exhaustion or zero active connections.

### Impact
All read/write operations fail. The system has no automatic read-only fallback; all order and custody endpoints return errors.

### Recovery steps
1. Check Postgres: `pg_isready -h <host> -p 5432`.
2. If connection pool exhausted: identify long-running queries and terminate them:
   ```sql
   SELECT pid, now() - query_start AS duration, query
   FROM pg_stat_activity
   WHERE state = 'active'
   ORDER BY duration DESC;

   SELECT pg_terminate_backend(<pid>);
   ```
3. Restart Postgres if needed: `systemctl restart postgresql`.
4. Verify connection pool recovers in backend logs (TypeORM/Prisma reconnect automatically).
5. If a migration caused the outage, roll it back:
   ```bash
   npm run migration:revert
   ```

---

## 4. Soroban RPC Unavailable

### Detection signals
- Contract-activity feed shows no new events.
- Backend logs show `RPC request failed` or timeout against the configured `SOROBAN_RPC_URL`.
- On-chain features (custody proof, payment settlement) return errors.

### Impact
Blockchain-dependent features degrade: custody trail anchoring, on-chain payment settlement, contract event indexing. Off-chain CRUD still works.

### Recovery steps
1. Confirm the outage is external: check the Stellar status page.
2. Switch to a backup RPC endpoint by updating the environment variable:
   ```bash
   # In .env or platform secrets
   SOROBAN_RPC_URL=https://soroban-testnet.stellar.org   # testnet fallback
   # or a private Horizon/Soroban node
   ```
3. Restart the backend to pick up the new URL.
4. Once the primary RPC recovers, revert `SOROBAN_RPC_URL` and restart again.
5. Re-index any missed ledgers by triggering the indexer catch-up job.

---

## 5. Blood Request Stuck in Processing

### Detection signals
- Order status remains `processing` for more than 10 minutes.
- Saga orchestrator logs show a step that never emitted its completion event.
- BullMQ job for the saga is in `active` or `stalled` state.

### Impact
A hospital's blood request is not fulfilled; a rider is not dispatched. This is a critical patient-safety issue.

### Recovery steps
1. Identify the stuck order ID from the admin console or database:
   ```sql
   SELECT id, status, created_at, saga_state
   FROM orders
   WHERE status = 'processing'
     AND created_at < NOW() - INTERVAL '10 minutes';
   ```
2. Inspect the saga state to determine which step is stuck.
3. To manually advance the saga, emit the missing event via the admin API:
   ```bash
   POST /api/v1/admin/orders/:orderId/saga/advance
   { "step": "<stuck-step-name>" }
   ```
4. To cancel the saga and notify the hospital:
   ```bash
   POST /api/v1/admin/orders/:orderId/cancel
   { "reason": "saga timeout — manual cancellation by operator" }
   ```
5. Check BullMQ for a stalled job and retry or remove it via Bull Board.
6. Escalate to engineering if the saga cannot be advanced without a code fix.

---

## Reference Links

- Health endpoint: `GET <API_BASE_URL>/health`
- Grafana dashboards: _add URL once provisioned_
- Bull Board (queue UI): `<API_BASE_URL>/admin/queues`
- Stellar network status: https://status.stellar.org
