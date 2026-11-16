# deplo.ai — Deployment Engine & Cloud Orchestration Specification

> **Module Owner:** Aridaman Singh  
> **Shift Goal:** Accept generated configuration, orchestrate backend-first deployment, configure cloud providers (Render & Vercel), manage environment variables and CORS, and stream real-time telemetry.  
> **Target Providers:** Render (Backend Web Service), Vercel (Frontend Client)  
> **Orchestration Pattern:** Backend-First with Dynamic Dependency Injection & Rolling CORS Redeployment  

---

## 1. Architectural Overview

The **deplo.ai Deployment Engine** is a high-reliability, asynchronous cloud orchestration system built into the Express API gateway. It eliminates the circular dependency problem common in modern full-stack web applications by guaranteeing strict, health-verified sequential provisioning:

```
[Repository Analysis / Configuration]
                  │
                  ▼
       1. Repository Inspection
                  │
                  ▼
       2. Render Backend Deploy
                  │
                  ▼
       3. Backend HTTP Health Check
                  │
                  ▼
       4. Vercel Environment Injection (VITE_API_URL = live backend URL)
                  │
                  ▼
       5. Vercel Frontend Deploy & Readiness Poll
                  │
                  ▼
       6. Frontend HTTP Health Verification
                  │
                  ▼
       7. Render CORS Update (Add frontend origin to CORS_ORIGINS & redeploy)
                  │
                  ▼
          [Deployment SUCCESS]
```

---

## 2. Deployment State Machine & Step Telemetry

Every deployment pipeline execution is tracked via Prisma in PostgreSQL with fine-grained status transitions and individual step records:

### 2.1 Deployment Lifecycle States

| State | Description |
|---|---|
| `QUEUED` | Pipeline initialized; record and step entities created in PostgreSQL. |
| `ANALYZING` | Configuration sanity check and repository parameters inspected. |
| `DEPLOYING_BACKEND` | Render web service provisioning or deploy trigger in progress. |
| `HEALTH_CHECKING` | HTTP probing with exponential backoff on `/health` or custom path. |
| `DEPLOYING_FRONTEND` | Vercel project configuration, env injection, and build in progress. |
| `SUCCESS` | Both services deployed, healthy, and cross-origin permissions configured. |
| `FAILED` | Pipeline halted at failure point; subsequent steps marked `SKIPPED`. |

### 2.2 Seven-Step Sequential Telemetry

Each deployment record automatically initializes 7 ordered `DeploymentStep` entities:
1. **Repository Inspection** (`GITHUB`)
2. **Backend Build & Deploy** (`RENDER`)
3. **Backend Health Verification** (`RENDER`)
4. **Environment URL Injection** (`VERCEL`)
5. **Frontend Build & Deploy** (`VERCEL`)
6. **Frontend Health Verification** (`VERCEL`)
7. **Backend CORS Update & Verification** (`RENDER`)

---

## 3. Cloud Provider Adapters

### 3.1 Render Adapter (`render.service.js`)
* **API Version:** Render REST API v1 (`https://api.render.com/v1`)
* **Service Provisioning:** Provisions starter/free web services with customized `rootDir`, `buildCommand`, and `startCommand`.
* **Workspace Resolution:** Automatically queries and resolves workspace `ownerId` (`/owners`) or accepts configured `RENDER_OWNER_ID`.
* **Granular Env Var Updates:** `upsertRenderServiceEnvVar(serviceId, key, value)` updates specific environment variables (such as `CORS_ORIGINS`) without overwriting existing keys.
* **Polling & Logs:** Polls `/services/{id}/deploys/{id}` until reaching terminal state (`live` or `build_failed`) and fetches deploy events.
* **Secret Sanitization:** `sanitizeRenderError` intercepts axios errors and strips OAuth tokens, API keys, and sensitive internal paths before surfacing messages.

### 3.2 Vercel Adapter (`vercel.service.js`)
* **API Version:** Vercel REST API v9/v10/v13 (`https://api.vercel.com`)
* **Project Management:** `ensureVercelProject` handles framework auto-detection (`REACT_VITE`, `NEXT_JS`, `VUE`, etc.), sets monorepo `rootDirectory`, and ensures correct `outputDirectory` (`dist`).
* **Environment Variable Propagation:** `upsertVercelEnvVars` propagates shared and frontend-specific variables across `production` and `preview` environments, supporting plain and sensitive/encrypted secrets.
* **Dependency Injection:** Injects `VITE_API_URL` pointing to the live Render backend URL before triggering the frontend build.
* **Deployment Trigger & Readiness:** Triggers production deployments and polls until reaching `READY` or reporting structured build errors.

---

## 4. Real-Time Telemetry & Monitoring APIs

Clients can observe deployment execution in real-time through multiple complementary protocols:

### 4.1 Server-Sent Events (SSE) Live Log Streaming
* **Endpoint:** `GET /api/deploy/:id/stream`
* **Headers:** `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`
* **Features:**
  * Real-time streaming with 3-second low-latency database polling.
  * Automatic 15-second heartbeat packets (`event: heartbeat`) to maintain open proxy and gateway tunnels.
  * Emits structured event types: `event: log`, `event: status`, `event: done`, `event: error`.
  * Closes gracefully upon terminal deployment state (`SUCCESS`, `FAILED`, `CANCELLED`).

### 4.2 Paginated Log Polling
* **Endpoint:** `GET /api/deploy/:id/logs`
* **Query Parameters:** `limit` (1-500, default 100), `after` (cursor BigInt log ID)
* **Response:** Array of ordered logs with next cursor pagination support.

### 4.3 Live Public URL Inspection
* **Endpoint:** `GET /api/deploy/:id/urls`
* **Response:**
```json
{
  "success": true,
  "data": {
    "deploymentId": "b1a43f8e-...",
    "status": "SUCCESS",
    "backendUrl": "https://deplo-api.onrender.com",
    "frontendUrl": "https://deplo-frontend.vercel.app",
    "completedAt": "2026-11-15T13:45:00.000Z"
  }
}
```

### 4.4 Multi-Service Health Inspection
* **Endpoint:** `GET /api/deploy/:id/health`
* **Behavior:** Probes both frontend and backend endpoints over HTTP, verifying response status codes (200-399) and measuring millisecond latency.

---

## 5. Shared API Contract Implementation

Per the deplo.ai team plan, the deployment engine exposes unversioned shared contract routes alongside versioned endpoints:

| Endpoint | Method | Owner | Function |
|---|---|---|---|
| `/api/deploy` | `POST` | Aridaman | Validate configuration and initiate sequential orchestration |
| `/api/deploy/:id` | `GET` | Aridaman | Retrieve complete deployment telemetry and step states |
| `/api/deploy/:id/logs` | `GET` | Aridaman | Paginated log polling |
| `/api/deploy/:id/stream` | `GET` | Aridaman | Real-time Server-Sent Events stream |
| `/api/deploy/:id/health` | `GET` | Aridaman | Active multi-service HTTP health verification |
| `/api/deploy/:id/urls` | `GET` | Aridaman | Retrieve verified frontend and backend public URLs |
| `/api/deploy` | `GET` | Aridaman | Retrieve historical deployments by project ID |
| `/api/deploy/:id/retry` | `POST` | Aridaman | Retry a failed deployment with attempt counter increment |
| `/api/config/generate` | `POST` | Satakshi / Aridaman | Generate structured deployment configuration from analysis |
| `/api/analyze` | `POST` | Satakshi / Aridaman | Shared alias for repository analysis |

---

## 6. Verification & Test Suite

The engine includes a dedicated automated regression and verification runner:
* **Test Runner:** `server/test-deployment-engine.js`
* **Execution:** `node server/test-deployment-engine.js`
* **Test Coverage:**
  1. Server health check and API availability
  2. Configuration validator sanity checks (invalid providers, missing commands, path traversal)
  3. Provider adapter interface contracts
  4. Sequential deployment trigger and UUID generation
  5. Live log pagination and cursor traversal
  6. Server-Sent Events connection and event format
  7. Multi-service health check execution
  8. Historical querying and retry state transitions
  9. Shared API contract validation (`/api/analyze`, `/api/config/generate`)
