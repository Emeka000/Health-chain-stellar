# Disaster Recovery Drill Framework

## Scenarios
- Partial DB loss
- Delayed indexer
- Corrupted projections
- Ledger gaps

## Drill Steps
1. Restore database backup
2. Replay events
3. Re-sync ledger state

## Verification
- Compare on-chain vs off-chain records
- Validate payment and contract events

## Metrics
- Track RTO and RPO
- Log failures and remediation tasks

## Notes
- Run drills periodically
- Document outcomes
