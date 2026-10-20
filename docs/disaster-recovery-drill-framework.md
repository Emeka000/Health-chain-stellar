# Disaster-recovery drill framework

This runbook is for the Health-Chain backend (`backend/`). It covers the PostgreSQL source of truth, Redis/BullMQ workers, the Soroban event indexer, and the projections that power blood requests, dispatch, and cold-chain views. Run it in staging first with production-like data volumes. Never run a restore or replay against production without an approved change window and a fresh backup.

## Ownership and success criteria

The incident commander owns the change window and records the drill. The backend owner runs commands; the database owner confirms backup integrity; the blockchain owner confirms the ledger range and RPC endpoint. A drill passes only when the service is healthy, no duplicate projections are created, and the verification queries below reconcile the restored state with the source systems.

The following are initial targets, not measured results. Replace them after the first drill and keep measured RTO/RPO in the drill record.

| Component | Recovery point objective | Recovery time objective | Why |
| --- | ---: | ---: | --- |
| PostgreSQL | 15 minutes | 60 minutes | Orders, blood requests, dispatch, telemetry, and indexer state are durable here. |
| Redis/BullMQ | 0 minutes for durable DB records; queued work may be replayed | 30 minutes | Redis is a worker/queue dependency; business state must not exist only in Redis. |
| Soroban event indexer | 1 ledger from the recorded checkpoint | 60 minutes | `soroban_indexer_state` records the last successfully processed ledger. |
| API and projections | 15 minutes | 60 minutes | Rebuild from PostgreSQL and replayable blockchain events. |

## Recovery commands

Set these variables in the operator shell. Do not put passwords in shell history or commit them to the repository.

```bash
export DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/DBNAME'
export BACKUP_FILE="/secure/drill/health-chain-$(date -u +%Y%m%dT%H%M%SZ).dump"
export API_DIR=/srv/health-chain/backend
```

### PostgreSQL backup and restore

```bash
pg_dump --format=custom --no-owner --file="$BACKUP_FILE" "$DATABASE_URL"
pg_restore --list "$BACKUP_FILE" >/tmp/health-chain-backup.contents
test -s /tmp/health-chain-backup.contents
```

For a restore drill, use an isolated database. The following command intentionally drops objects in that database:

```bash
createdb --host "$PGHOST" --port "${PGPORT:-5432}" --username "$PGUSER" health_chain_drill
export DRILL_DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/health_chain_drill'
pg_restore --clean --if-exists --no-owner --dbname="$DRILL_DATABASE_URL" "$BACKUP_FILE"
psql "$DRILL_DATABASE_URL" -X -v ON_ERROR_STOP=1 -c "SELECT current_database(), count(*) FROM information_schema.tables WHERE table_schema = 'public';"
```

The repository migration scripts use compiled `backend/dist/data-source.js`, so build before applying pending migrations:

```bash
cd "$API_DIR"
npm ci
npm run build
npm run migration:run
```

### Redis and BullMQ

Redis is a dependency for notifications, blood-request, donor-outreach, report-export, and Soroban transaction queues. Confirm it before starting workers:

```bash
redis-cli -h "$REDIS_HOST" -p "${REDIS_PORT:-6379}" ping
redis-cli -h "$REDIS_HOST" -p "${REDIS_PORT:-6379}" INFO persistence
```

If Redis data is lost, restore it using the platform’s approved RDB/AOF procedure, then verify workers through Bull Board and `/health/ready`. Do not invent business records from Redis. Re-enqueue failed work only after PostgreSQL has been verified, and do not bulk-retry jobs that already produced a durable order or payment result.

### Replay projections and blockchain events

The event indexer stores events in `blockchain_events`. To replay a bounded range in a drill database, preserve the original rows and reset only that range:

```bash
psql "$DRILL_DATABASE_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
UPDATE blockchain_events
SET processed = false
WHERE blockchain_timestamp >= TIMESTAMPTZ '2026-01-01 00:00:00+00:00'
  AND blockchain_timestamp <  TIMESTAMPTZ '2026-01-02 00:00:00+00:00';
COMMIT;
SQL
```

Start the backend workers and allow the five-minute indexer job to drain the range. Confirm no events remain unprocessed and inspect reconciliation results:

```bash
psql "$DRILL_DATABASE_URL" -X -c 'SELECT count(*) AS unprocessed FROM blockchain_events WHERE processed = false;'
psql "$DRILL_DATABASE_URL" -X -c "SELECT status, count(*) FROM reconciliation_logs GROUP BY status ORDER BY status;"
```

For a Soroban ledger gap, record the last known good ledger and reset the payment checkpoint to one ledger before the approved replay range. The 30-second reconciliation job then fetches forward:

```bash
psql "$DRILL_DATABASE_URL" -X -v ON_ERROR_STOP=1 -c "UPDATE soroban_indexer_state SET last_ledger_sequence = 1234567 WHERE key = 'payment-reconciliation';"
```

Replace `1234567` with the approved checkpoint; do not guess it. Verify the RPC endpoint first with `curl -fsS "$SOROBAN_RPC_URL"` and confirm the checkpoint advances in application logs.

## Drill scenarios

### Partial PostgreSQL loss

1. Freeze writes and record the incident start time.
2. Restore the latest backup into an isolated database.
3. Run `npm run migration:run`, start the API, and check `/health/details`.
4. Compare row counts for `orders`, `blood_requests`, `dispatch_records`, `temperature_samples`, `blockchain_events`, and `soroban_indexer_state`.
5. Run the bounded event replay and reconciliation queries above.

### Redis/BullMQ outage

1. Confirm `redis-cli ping` fails and record queue depth from Bull Board.
2. Restore or restart Redis, then confirm `/health/details` reports `redis` and `bullmq` as `up`.
3. Retry only failed jobs that have not already produced a durable result.
4. Verify blood-request, notification, and Soroban queue depth returns to baseline.

### Corrupted projections or delayed indexer

1. Stop the worker that writes the affected projection.
2. Take a database backup before changing `processed` or an indexer checkpoint.
3. Replay the smallest affected event or ledger range.
4. Compare on-chain payment status with `orders` and inspect `reconciliation_logs` for `DISCREPANCY` rows.
5. Resume workers and record the highest successfully processed ledger.

### Cold-chain data loss

1. Restore `temperature_samples` from the PostgreSQL backup.
2. Re-submit only telemetry records confirmed by the source system; the ingestion pipeline deduplicates within its fingerprint window.
3. Verify `GET /cold-chain/deliveries/:deliveryId/timeline` and `/compliance` for affected deliveries.
4. Record sensor sequence gaps and unresolved excursions for manual review.

## Drill evidence and review

Record the drill ID, environment, backup timestamp, checkpoint ledger, start/end times, rows before/after, queue depths, discrepancy count, RTO/RPO, commands used, and follow-up owners. Attach logs without credentials, tokens, patient data, or full request bodies. Run quarterly and after database, queue, or Soroban indexer migrations.
