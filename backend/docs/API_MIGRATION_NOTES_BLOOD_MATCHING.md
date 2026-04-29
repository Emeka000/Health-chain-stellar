# API Migration Notes: Blood Matching

## Scope

- Endpoint: `GET /api/v1/blood-matching/compatible-donors`
- Compatibility class: `additive`
- Legacy adapter support: enabled via `X-API-Client-Shape: legacy` or `?compat=legacy`

## Canonical vs Legacy Response

### Canonical (default)

```json
{
  "recipientType": "A+",
  "component": "RED_CELLS",
  "allowEmergencySubstitution": false,
  "donors": [
    {
      "donorType": "O-",
      "matchType": "compatible",
      "explanation": "..."
    }
  ]
}
```

### Legacy adapter shape

```json
["O-", "A-", "A+"]
```

## Deprecation Metadata

The endpoint emits:

- `X-API-Compatibility-Class: additive`
- `Deprecation: true`
- `Sunset: Wed, 31 Dec 2026 23:59:59 GMT`
- `Link: </api/v2/blood-matching/compatible-donors>; rel="successor-version"`
- `X-API-Response-Shape: canonical|legacy`

Legacy consumers should migrate to canonical shape before sunset.

## Deprecated Endpoints

- `GET /api/v1/blood-matching/compatible-types`
- `GET /api/v1/blood-matching/donatable-types`

Use `GET /api/v1/blood-matching/compatible-donors` as the successor endpoint.
