# Matching Contract

The matching contract allocates available blood units to requests. It exposes two entrypoints: `match_request` for a single request and `match_multiple_requests` for batch matching.

## Entrypoints

### `match_request`

```rust
pub fn match_request(
    env: Env,
    request_id: u64,
) -> Result<MatchResult, MatchingError>
```

Matches a single request against available inventory. Returns the units allocated to the request.

### `match_multiple_requests`

```rust
pub fn match_multiple_requests(
    env: Env,
    request_ids: Vec<u64>,
) -> Result<Vec<MatchResult>, MatchingError>
```

Matches several requests in one call, returning one `MatchResult` per processed request.

#### Batch size limit

The number of request IDs accepted in a single call is capped by `MAX_BATCH_SIZE`. If `request_ids.len() > MAX_BATCH_SIZE`, the call fails with `MatchingError::BatchTooLarge` and no matching is performed.

An empty `request_ids` list is valid and returns an empty result vector.

#### Ordering

Requests are processed in priority order so that the most urgent needs are satisfied first:

1. **Urgency** — `Critical` → `Urgent` → `Routine` → `Scheduled`.
2. **`required_by_timestamp`** — within the same urgency, requests with the earliest `required_by_timestamp` are processed first.

#### Cross-batch unit exclusion

Units allocated to an earlier request in the same batch are excluded from consideration for later requests. Internally, each request is matched via `match_request_excluding` with a running exclusion list of unit IDs already selected in the batch. This guarantees that no unit ID appears in more than one `MatchResult` of the same batch, preventing double-allocation of the same `Available` units across competing requests.

#### Skipping invalid requests

Invalid or non-`Pending` requests are skipped rather than aborting the whole batch. A skipped request does not produce a `MatchResult`, and matching continues for the remaining requests. This keeps a single bad request ID from failing an otherwise valid batch.

## Errors

| Error | Condition |
| --- | --- |
| `BatchTooLarge` | `request_ids.len() > MAX_BATCH_SIZE` in `match_multiple_requests`. |
| Other `MatchingError` variants | Propagated from single-request matching as appropriate. |

## Example

Two `Pending` requests compete for three compatible units. Calling `match_multiple_requests` with both IDs returns two results whose allocated unit IDs are disjoint — no unit is offered to both requests.