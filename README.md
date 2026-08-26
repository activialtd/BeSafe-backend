# BeSafe API

Backend for **BeSafe** — the Lagos transportation verification & safety platform. Not a ride-hailing app: a verification layer for existing danfos, kekes, taxis, and okadas.

## Stack

- **Runtime**: Node.js 20, TypeScript 5.7
- **Framework**: NestJS 10 (Express under the hood)
- **DB**: PostgreSQL 16 via **Drizzle ORM** 0.36
- **Cache / rate limit**: Redis 7
- **Realtime**: Socket.IO 4.8 (with HTTP polling fallback)
- **Auth**: JWT (access + refresh, jti-tracked in DB), Argon2id for OTP & PIN hashing
- **Identity providers**: **Mono** (NIN lookup), **VerifyMe** (driver's license — FRSC data)
- **SMS**: Twilio
- **Validation**: Zod (schema-first, same DTOs for HTTP + WS)
- **Resilience**: axios + axios-retry + opossum circuit breaker

## Run it (5 minutes)

```bash
# 1) copy env and edit if you want
cp .env.example .env

# 2) start postgres + redis + api
docker compose up -d

# 3) once postgres is healthy, run migrations (from host or exec into api container)
docker compose exec api node dist/db/migrate.js
# OR from host with local Node:
npm install
npm run db:migrate
```

- API: <http://localhost:4000>
- Swagger docs: <http://localhost:4000/docs>
- Health: <http://localhost:4000/health> and <http://localhost:4000/health/deep>

### Dev without Docker

```bash
# Just start postgres + redis via compose
docker compose up -d postgres redis

npm install
cp .env.example .env
npm run db:migrate
npm run start:dev
```

## Environment

Every variable is validated at boot by Zod (`src/config/env.ts`). Missing or malformed values → the app refuses to start with a readable error.

Key flags:

- `FEATURE_STUB_IDENTITY_PROVIDERS=true` — don't hit real Mono/VerifyMe; return mock data. Use in dev.
- `FEATURE_STUB_SMS=true` — don't send real SMS; log OTPs to console. The `/auth/otp/request` response also echoes the OTP in `debugCode` when this is on.

## Response contract

**Every** response — success and error — has the same envelope:

```jsonc
// success
{ "ok": true, "data": { ... }, "correlationId": "…", "timestamp": "2026-08-22T22:41:00.000Z" }

// error
{
  "ok": false,
  "error": { "code": "VEHICLE_NOT_VERIFIED", "message": "…", "details": { ... } },
  "correlationId": "…",
  "timestamp": "…"
}
```

- `correlationId` — pass `x-correlation-id` on the way in and it flows through logs + audit + response header. If you don't, one is generated for you.
- `error.code` — typed union in `src/common/api-error.ts`. The mobile client can `switch(code)` on it.
- The backend **never crashes** the process on request handling. A global filter catches every exception (ApiError, ZodError, HttpException, unknown) and returns the shaped envelope.

## Live location — how it actually works

**Sockets primary, HTTP fallback**, because 2G in Lagos is unpredictable.

### WebSocket (Socket.IO)

- Namespace: `/rides`
- Handshake auth: either `token` (JWT) for the rider, or `watchToken` (from a share) for anonymous emergency-contact watchers.

```js
// Rider
const socket = io('ws://localhost:4000/rides', { auth: { token: accessToken } });
socket.emit('ride:join', { rideId });
setInterval(() => {
  socket.emit('ride:ping', { rideId, lat, lng, accuracyMeters, speedMps });
}, 5000);

// Watcher (from an SMS link)
const socket = io('ws://localhost:4000/rides', { auth: { watchToken } });
socket.on('ride:location', (msg) => { /* draw pin */ });
```

### HTTP fallback

If the socket has been dead >15s, the client posts:

```http
POST /rides/:id/ping
Authorization: Bearer <jwt>
{ "lat": 6.5244, "lng": 3.3792, "source": "http" }
```

Recommended cadence: **5s over WS, 30s over HTTP**. Location accuracy set to Balanced on the client — battery-friendly, still ~20m precision in a moving vehicle.

### Watch link

When a rider shares a trip with contact X, the server creates a `rideShares` row with a `watchToken`. The SMS to that contact includes a link like `https://besafe.ng/w/<watchToken>`. Anyone with the token can watch the live location via HTTP `GET /rides/watch/:token` (single-shot) or the socket handshake with `watchToken`.

## Auditability

Every state-changing action writes an immutable row to `audit_events`:

```
{ actorId, actorRole, action, targetType, targetId, before, after, correlationId, ip, userAgent, metadata, createdAt }
```

Actions use dot-notation: `auth.otp.requested`, `vehicle.registered`, `ride.started`, `sos.triggered`, `sos.cancelled`, …

- Never UPDATE, never DELETE — inserts only.
- Fire-and-forget: audit write failures never break user flows.
- Government endpoint `GET /gov/audit?action=…&from=…&to=…` returns filtered slices.

## Resilience

External APIs (Mono, VerifyMe, Twilio) go through `ResilientHttp`:

- **Timeout** per request (configurable per provider)
- **Retry** with exponential backoff on network errors and 5xx
- **Circuit breaker** (opossum): opens at 50% error rate, 20s reset window, half-open probes
- When the breaker is open, the caller sees `CIRCUIT_OPEN` immediately instead of piling up requests

DB pool errors are swallowed at pool level. The Express layer has `unhandledRejection` and `uncaughtException` handlers of last resort.

## Endpoints (short tour)

Auth is Bearer JWT unless noted `Public`.

### Auth
| Method | Path | Notes |
|---|---|---|
| POST | `/auth/otp/request` | Public. `{phone, purpose}` — send OTP. Returns `debugCode` if stubbed. |
| POST | `/auth/otp/verify` | Public. `{phone, code}` — returns `{accessToken, refreshToken, user}`. |
| POST | `/auth/role` | Auth. `{role: 'rider'\|'driver', fullName}` — reissues tokens. |
| POST | `/auth/nin/verify` | Auth. `{nin, dateOfBirth?}` — verifies via Mono, stores hash + last4. |
| POST | `/auth/sos-pin` | Auth. `{pin}` — 4–6 digit. Stored as argon2id. |
| POST | `/auth/refresh` | Public. `{refreshToken}` — rotates. |
| POST | `/auth/logout` | Auth. Revokes refresh. |
| GET | `/auth/me` | Auth. |

### Riders (emergency contacts)
| Method | Path | |
|---|---|---|
| GET | `/rider/contacts` | List (max 5). |
| POST | `/rider/contacts` | `{name, phone, relationship?}` |
| DELETE | `/rider/contacts/:id` | |

### Drivers
| Method | Path | |
|---|---|---|
| GET | `/driver/me` | Driver profile + vehicles. |
| POST | `/driver/license/verify` | `{licenseNumber, dateOfBirth?}` via VerifyMe. |
| POST | `/driver/vehicles` | Register vehicle → returns `qrToken`. |
| DELETE | `/driver/vehicles/:id` | `{reason}` — revokes QR. |
| PUT | `/driver/online` | `{online: boolean}` |

### Verify (public rider-facing lookup)
| Method | Path | |
|---|---|---|
| POST | `/verify/qr` | `{qrToken}` — returns driver + vehicle + warnings. |
| POST | `/verify/plate` | `{plate}` — same, by plate number. |

### Rides
| Method | Path | |
|---|---|---|
| POST | `/rides` | `{vehicleId}` — start a monitored timespan. |
| POST | `/rides/:id/ping` | HTTP fallback for location. |
| POST | `/rides/:id/end` | `{reason: 'arrived'\|'cancelled'\|'sos_resolved'}` |
| PUT | `/rides/:id/shares` | `{contactIds: string[]}` — set the active watchers. |
| GET | `/rides/watch/:token` | Public. Snapshot of a shared trip. |
| GET | `/rides/history` | User's own rides (rider or driver). |

### SOS
| Method | Path | |
|---|---|---|
| POST | `/sos` | `{lat, lng, type?, rideId?}` — triggers, fans out SMS to contacts + authority attempts. |
| POST | `/sos/:id/cancel` | `{pin}` — PIN-guarded. Max 3 attempts. |
| POST | `/sos/:id/resolve` | `{note?}` |
| GET | `/sos/mine` | History. |

### Government
| Method | Path | Roles |
|---|---|---|
| GET | `/gov/stats` | gov, admin |
| GET | `/gov/sos/active` | gov, admin — live SOS feed |
| GET | `/gov/audit` | gov, admin — filter by action/actor/date |

### Health
| Method | Path | |
|---|---|---|
| GET | `/health` | Liveness. |
| GET | `/health/deep` | Pings Postgres. |

## Provider setup

### Mono (NIN)
1. Get a Mono account, create a **Business** app.
2. Enable the **Identity** product (NIN Lookup).
3. Copy the **Secret Key** (`sk_test_…` in test, `sk_live_…` in prod) into `MONO_SECRET_KEY`.
4. Endpoint used: `POST /v2/lookup/nin` with header `mono-sec-key`.

### VerifyMe (Driver's License)
1. Sign up at <https://verified.africa>.
2. From the dashboard, get your **userId** and **API key**.
3. Fill `VERIFYME_USER_ID`, `VERIFYME_API_KEY`.
4. Endpoint used: `POST /v2/biobject/drivers-license/full` with headers `userid` + `apiKey`.

> Both providers hide behind the `IdentityService` facade. Swap adapters without touching business logic.

### Twilio (SMS)
Standard Account SID + Auth Token + From Number. Set `FEATURE_STUB_SMS=false` when ready.

## Scripts

```bash
npm run start:dev       # nest watch mode
npm run start:prod      # node dist/main
npm run build           # compile
npm run db:generate     # generate migrations from schema
npm run db:migrate      # apply pending migrations
npm run db:studio       # drizzle-kit visual browser
npm run test            # jest
npm run docker:up
npm run docker:down
npm run docker:logs
```

## Project layout

```
src/
  config/env.ts                    Zod-validated env
  common/
    api-error.ts                   Typed error union + status mapping
    auth.guard.ts                  JwtAuthGuard + @Roles + @CurrentUser + @Public
    id.ts                          cuid2 / nanoid helpers, buildQrToken()
    resilient-http.ts              axios + retry + circuit breaker
    filters/global-exception.filter.ts
    interceptors/response-envelope.interceptor.ts
    middleware/correlation-id.middleware.ts
    pipes/zod-validation.pipe.ts
  db/
    db.module.ts                   Drizzle + pg pool
    migrate.ts                     Migration runner
    schema/                        users, vehicles, rides, sos, audit
    migrations/                    Generated SQL
  modules/
    audit/                         Fire-and-forget audit writer
    identity/                      Mono + VerifyMe adapters + facade
    notifications/                 Twilio SMS
    auth/                          OTP, tokens, role, NIN, SOS PIN
    riders/                        Emergency contacts CRUD
    drivers/                       License verification, vehicle registration
    verify/                        Public QR + plate lookup
    rides/                         Start/ping/end/share/watch
    sos/                           Trigger/cancel/resolve
    gov/                           Government dashboard endpoints
    health/                        Liveness + deep readiness
  gateways/
    rides.gateway.ts               Socket.IO for live tracking
  jobs/
    maintenance.jobs.ts            Cron: stale rides, cleanup
  app.module.ts
  main.ts
docker/Dockerfile
docker-compose.yml
```

## Notes for the mobile client

- Toggle `USE_MOCK=false` in `services/api.ts` and point `BASE_URL` to `http://<your-lan-ip>:4000`.
- On login, save both tokens with `expo-secure-store`. On 401 with `code: 'UNAUTHENTICATED'`, refresh once and retry the original request; on second failure, force logout.
- For live tracking, open a socket immediately after `/rides` returns. Fall back to HTTP posts every 30s if the socket has been closed >15s.
- The SOS PIN is required to cancel a triggered SOS. Enforce this in the UI (already done on your `sos.tsx`).
