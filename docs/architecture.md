# HealthChain Stellar — Architecture

## System Overview

```mermaid
graph TD
    FE["Next.js Frontend :3000"]
    BE["NestJS Backend :3001"]
    PG[("PostgreSQL")]
    RD[("Redis")]
    SC["Stellar / Soroban Contracts"]
    SMS["Africa's Talking (SMS)"]
    PUSH["Firebase (Push)"]
    SMTP["SMTP"]
    MAPS["Google Maps API"]

    FE -->|"REST (api/v1/*)"| BE
    FE -->|"WebSocket"| BE

    BE -->|"TypeORM"| PG
    BE -->|"ioredis"| RD
    BE -->|"Soroban RPC"| SC
    BE -->|"SMS"| SMS
    BE -->|"FCM"| PUSH
    BE -->|"SMTP"| SMTP
    BE -->|"Directions / Geocode"| MAPS
```

---

## Backend Module Boundaries

```mermaid
graph TD
    subgraph Core["Core Infrastructure"]
        AUTH[AuthModule]
        USERS[UsersModule]
        REDIS[RedisModule]
        CONFIG[AppConfigModule]
    end

    subgraph BloodSupplyChain["Blood Supply Chain"]
        BR[BloodRequestsModule]
        BU[BloodUnitsModule]
        INV[InventoryModule]
        BM[BloodMatchingModule]
        DISP[DispatchModule]
        TRACK[TrackingModule]
        CC[ColdChainModule]
        DP[DeliveryProofModule]
        CUST[CustodyModule]
    end

    subgraph Payments["Payments & Governance"]
        ESC[EscrowGovernanceModule]
        FEE[FeePolicyModule]
        FEEFIX[FeeCorrectionModule]
        REC[ReconciliationModule]
        DISPUTES[DisputesModule]
        PB[ProofBundleModule]
    end

    subgraph Actors["Actors"]
        HOSP[HospitalsModule]
        ORG[OrganizationsModule]
        RIDERS[RidersModule]
        DONA[DonationModule]
        DE[DonorEligibilityModule]
        DI[DonorImpactModule]
        REP[ReputationModule]
    end

    subgraph Blockchain["Blockchain"]
        SOROB[SorobanModule]
        CEI[ContractEventIndexerModule]
        BC[BlockchainModule]
    end

    subgraph Async["Async / Queue (BullMQ → Redis)"]
        WQ["blood-request queue\n→ BloodRequestProcessor"]
        NQ["notification queue\n→ NotificationProcessor"]
        STX["soroban-tx queue\n→ SorobanTxProcessor"]
        RQ["report-export queue\n→ ReportExportProcessor"]
        DO["donor-outreach queue\n→ DonorOutreachProcessor"]
    end

    subgraph WebSockets["WebSocket Gateways"]
        EG[EscalationGateway]
        LOG[LiveOpsGateway]
        TG[TrackingGateway]
        NG[NotificationsGateway]
        OG[OrdersGateway]
        RLG[RiderLocationGateway]
        RDG[RouteDeviationGateway]
    end

    subgraph Observability["Observability"]
        HEALTH[HealthModule]
        SLA[SlaModule]
        ANALY[AnomalyModule]
        READY[ReadinessModule]
        REPORT[ReportingModule]
        ANALYT[contract-event-indexer analytics]
    end

    AUTH --> USERS
    BR --> WQ
    BC --> STX
    NOTIF[NotificationsModule] --> NQ
    REPORT --> RQ
    INV --> DO

    BR --> EG
    DISP --> LOG
    TRACK --> TG
    NOTIF --> NG
    ORDERS[OrdersModule] --> OG
    RIDERS --> RLG
    RD_MOD[RouteDeviationModule] --> RDG

    SOROB --> SC[("Soroban RPC")]
    CEI --> SOROB
    BC --> SOROB
```

---

## Data Flow — Blood Request Lifecycle

```mermaid
sequenceDiagram
    participant FE as Next.js Frontend
    participant BE as NestJS :3001
    participant PG as PostgreSQL
    participant RD as Redis / BullMQ
    participant SC as Soroban Contract
    participant RIDER as Rider (WS)

    FE->>BE: POST /api/v1/blood-requests
    BE->>PG: INSERT blood_request (Pending)
    BE->>RD: enqueue blood-request job
    RD-->>BE: BloodRequestProcessor picks up job
    BE->>BE: BloodMatchingService.findMatch()
    BE->>PG: UPDATE blood_request (Matched)
    BE->>BE: DispatchService.createDispatch()
    BE->>SC: allocate_units() via SorobanService
    SC-->>BE: tx confirmed
    BE->>PG: INSERT dispatch_record
    BE->>RD: emit WS event → EscalationGateway
    RD-->>RIDER: WebSocket push (order assigned)
    RIDER->>BE: PATCH /api/v1/tracking (location updates)
    BE->>PG: INSERT location_history
    BE->>RD: emit WS event → TrackingGateway
    RD-->>FE: WebSocket push (live tracking)
    RIDER->>BE: POST /api/v1/delivery-proofs
    BE->>SC: confirm_delivery() via SorobanService
    SC-->>BE: tx confirmed
    BE->>SC: settle_payment() via CoordinatorContract
```

---

## Infrastructure Layout

```mermaid
graph LR
    subgraph Docker["docker-compose (local)"]
        PG_C["postgres:15\n:5432"]
        RD_C["redis:7\n:6379"]
    end

    subgraph Services["Application Services"]
        FE_S["Next.js\nlocalhost:3000"]
        BE_S["NestJS\nlocalhost:3001"]
    end

    subgraph Stellar["Stellar Network"]
        TEST["Soroban Testnet RPC\nsoroban-testnet.stellar.org"]
        MAIN["Soroban Mainnet RPC\nsoroban.stellar.org"]
    end

    BE_S --> PG_C
    BE_S --> RD_C
    FE_S --> BE_S
    BE_S -->|"dev/staging"| TEST
    BE_S -->|"production"| MAIN
```

---

## Key Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | NestJS listen port | `3001` |
| `DATABASE_*` | PostgreSQL connection | `localhost:5432` |
| `REDIS_HOST` / `REDIS_PORT` | Redis + BullMQ | `localhost:6379` |
| `SOROBAN_RPC_URL` | Stellar Soroban RPC | testnet URL |
| `SOROBAN_NETWORK` | `testnet` or `mainnet` | `testnet` |
| `JWT_SECRET` | Auth signing key | — |
| `CORS_ORIGIN` | Allowed frontend origins | `http://localhost:3000` |

See `backend/.env.example` for the full list.
