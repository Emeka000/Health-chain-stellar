# SLO instrumentation and burn-rate alerting

This guide defines signals available from the current backend. The service exposes public liveness (`/health/live`), dependency readiness (`/health/ready`), and an admin-only component breakdown rather than a Prometheus endpoint. Scrape these alongside structured application logs, the BullMQ metrics service, and domain read endpoints. Do not expose the detailed health response publicly: it requires `admin:access`.

## Service-level indicators

| Critical workflow | SLI and source | Measurement | Initial target |
| --- | --- | --- | ---: |
| Blood-request creation | HTTP success rate for `POST /blood-requests`; request duration from API access logs | successful requests / total requests, excluding 4xx validation failures | 99.5% / 99% under 1s |
| Dispatch assignment | HTTP success rate for `POST /dispatch`, `/dispatch/assign`, and `/dispatch/assignments/respond`; dispatch stats for pending/timeout outcomes | successful requests and completed assignments / eligible requests | 99.5% / 95% assigned within 5m |
| Cold-chain alerting | `POST /cold-chain/telemetry`; `TelemetryIngestionPipelineService` results and `getBackpressureStatus()` | accepted valid samples, quality rejects, duplicate rate, queue depth, and shedding | 99.9% accepted valid samples; queue depth < 1,000 |
| API availability | `GET /health/ready` plus admin `/health/details` component statuses | successful readiness checks / total checks; readiness covers `database` and `redis`, while details reports external providers | 99.9% monthly |
| Soroban reconciliation | `soroban_indexer_state.last_ledger_sequence`, `reconciliation_logs`, and RPC health | current ledger minus checkpoint, event processing errors, and `DISCREPANCY` count | lag < 2 ledgers; zero unowned discrepancies |
| Transaction worker | `QueueMetricsService.getDetailedMetrics()` for `soroban-tx-queue` and `soroban-dlq` | waiting, active, failed, delayed, DLQ depth, success/failure/retry counters, and `avgMs` | DLQ 0; failure < 1%; waiting returns to baseline |

Use stable route names and status classes as labels. Never label metrics with patient IDs, email addresses, transaction payloads, or unbounded exception messages.

## Workflow targets and ownership

These targets are starting points for staging and must be calibrated from at least two weeks of normal traffic. The on-call backend owner owns API and queue alerts; clinical operations owns blood-request and dispatch latency; the cold-chain owner owns telemetry freshness and excursion alerts; the blockchain owner owns ledger lag and reconciliation discrepancies.

For each SLI, retain numerator, denominator, window, and exclusion rules. A client-side 4xx caused by invalid input is not an API failure, but a 5xx, timeout, database failure, or queue rejection is.

## Burn-rate alerts

Let `error_budget` be `1 - SLO` and `bad_ratio` be bad events divided by all eligible events. The burn rate is `bad_ratio / error_budget`.

| Alert | Window | Condition | Action |
| --- | --- | --- | --- |
| Fast burn | 5 minutes and 1 hour | burn rate >= 14.4 in both windows | Page on-call; check `/health/details`, recent deploys, and queue/DLQ depth. |
| Medium burn | 30 minutes and 6 hours | burn rate >= 6 in both windows | Page during business hours; open an incident and inspect the affected workflow. |
| Slow burn | 3 hours and 24 hours | burn rate >= 3 in both windows | Create a ticket, assign an owner, and protect the remaining error budget. |
| Queue backlog | 10 minutes | waiting or delayed jobs grow continuously, or DLQ > 0 | Inspect Bull Board, worker logs, Redis, and idempotency before retrying. |
| Ledger lag | 10 minutes | checkpoint is more than two ledgers behind, or does not advance across two polls | Check `SOROBAN_RPC_URL`, indexer logs, and `soroban_indexer_state`; use the recovery drill before resetting a checkpoint. |
| Cold-chain shedding | 5 minutes | `shedding=true` or queue depth >= 1,000 | Page cold-chain owner; reduce input load and preserve source telemetry for replay. |

For a Prometheus-compatible collector, export one counter and one histogram per workflow rather than parsing arbitrary log text:

```text
health_chain_http_requests_total{route,method,status_class}
health_chain_http_request_duration_seconds{route,method}
health_chain_queue_jobs_total{queue,state}
health_chain_queue_job_duration_seconds{queue}
health_chain_soroban_indexer_lag_ledgers{indexer}
health_chain_soroban_discrepancies_total{event_type}
health_chain_cold_chain_samples_total{result}
health_chain_cold_chain_queue_depth
```

Until these exporters are deployed, derive the same values from structured access logs, `QueueMetricsService`, the health endpoints, and the SQL queries in the disaster-recovery drill framework. Alert definitions must not silently change when the exporter is introduced.

## Runbook links and dashboard panels

Every alert should link to the matching section of [`runbook.md`](./runbook.md) and include the affected workflow, first-seen time, current value, target, and dashboard panel. The minimum dashboard is:

1. API request rate, 4xx/5xx rate, and p50/p95/p99 duration for critical routes.
2. `/health/details` component status and health-check latency.
3. BullMQ waiting, active, failed, delayed, and DLQ depth, plus worker success/failure/retry counters and processing duration.
4. Soroban checkpoint, ledger lag, RPC failures, and reconciliation discrepancies.
5. Cold-chain accepted/rejected/duplicate samples, quality score distribution, queue depth, backpressure, and telemetry age.

## Review and error-budget policy

Review SLOs weekly during rollout and monthly after stabilization. Any alert without an owner or runbook link is incomplete. When a workflow uses more than 50% of its monthly error budget, pause non-essential changes and prioritize reliability work; at 100%, require an incident review before risky changes resume. Record target changes with the measured baseline and reason so historical comparisons remain meaningful.
