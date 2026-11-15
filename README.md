# deplo.ai 🚀

> **AI-Assisted Deployment & Cloud Orchestration Platform**  
> *Major College Project: Web Development • SQL Database • Interactive System Development*

---

## 📌 Project Overview

`deplo.ai` automates the complex multi-cloud deployment lifecycle of modern full-stack applications. By connecting to a developer's GitHub repository, `deplo.ai`:

1. Analyzes the repository structure to identify frontend and backend components
2. Recommends tailored deployment commands and environment configurations
3. Deploys the backend first via **Render**
4. Continuously verifies backend health via HTTP health checks
5. Automatically provisions and injects the live backend URL into the frontend environment
6. Builds and deploys the frontend via **Vercel**
7. Streams live build logs and state transitions in real time to both **Web** and **Desktop (Electron)** applications

---

## 🏗️ Architecture & Monorepo Structure

```
deplo.ai/
├── apps/
│   ├── web/          # React + Vite + Tailwind CSS Web Application
│   └── desktop/      # Electron.js Desktop Dashboard with native notifications
├── server/           # Node.js + Express.js REST API & Socket.IO Orchestration Gateway
├── database/         # PostgreSQL Schema, Prisma ORM, Analytical Views & SQL Queries
├── shared/           # Cross-package constants, contracts, and schemas (@deplo/shared)
├── docs/             # Technical architecture blueprints & viva defense documentation
├── .env.example      # Master environment configuration
└── package.json      # Root npm workspaces configuration
```

### Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite 5, Tailwind CSS, Lucide React |
| Desktop | Electron 34, React (shared with web), Node.js |
| Backend | Node.js, Express.js, Socket.IO |
| Database | PostgreSQL 14+, Prisma ORM |
| Authentication | JWT (access tokens), GitHub OAuth |
| Deployment | Render (backend), Vercel (frontend) |
| Real-time | Socket.IO (deployment logs, status, notifications) |
| Testing | Custom in-process test suites (40 tests, 0 failures) |

---

## 🛠️ Prerequisites

- **Node.js**: v18.0.0 or higher (v20+ recommended)
- **PostgreSQL**: v14.0 or higher
- **Git**
- **Cloud Accounts**: GitHub, Render (Free tier), Vercel (Hobby tier)
- **GitHub OAuth App**: Create at https://github.com/settings/developers

---

## 🚀 Quick Start (Development)

### 1. Clone & Install Dependencies

```bash
git clone <your-repo-url>
cd major_copy
npm install
```

### 2. Configure Environment Variables

```bash
cp .env.example .env
```

Edit `.env` (root) and `server/.env` with your values:

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `JWT_SECRET` | Strong random secret (min 32 chars) | Yes |
| `ENCRYPTION_KEY` | Strong random key (min 32 bytes) | Yes |
| `GITHUB_CLIENT_ID` | GitHub OAuth App Client ID | Yes |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App Client Secret | Yes |
| `GITHUB_CALLBACK_URL` | `http://localhost:5173/auth/callback` | Yes |
| `RENDER_API_KEY` | Render API key (for real deployments) | Yes (for deploys) |
| `VERCEL_API_KEY` | Vercel API token (for real deployments) | Yes (for deploys) |
| `VERCEL_TEAM_ID` | Vercel team ID (optional) | No |
| `ALLOW_SIMULATED_DEPLOYMENTS` | Dev-only simulation mode | No (default: false) |

**Important:** Never use insecure default values for `JWT_SECRET` or `ENCRYPTION_KEY` in production.

### 3. Initialize Database

```bash
# Run the schema SQL against your PostgreSQL database
psql -U postgres -d deplo_ai -f database/schema.sql

# Optionally seed with test data
psql -U postgres -d deplo_ai -f database/seed.sql
```

### 4. Run Applications

```bash
# Run all (server + web)
npm run dev

# Run server only
npm run dev:server

# Run web only
npm run dev:web

# Run Electron desktop only
npm run dev:desktop
```

- **Web**: http://localhost:5173
- **Server API**: http://localhost:5001
- **Desktop**: Electron window

---

## 🏗️ System Architecture

### Component Diagram

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│   Web Browser   │      │  Electron App   │      │   GitHub OAuth  │
│   (React+Vite)  │──────│   (Electron)    │──────│   (GitHub.com)  │
└────────┬────────┘      └────────┬────────┘      └────────┬────────┘
         │                        │                        │
         │ HTTP/Socket.IO         │ HTTP/Socket.IO         │ OAuth redirect
         ▼                        ▼                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Node.js + Express.js Server                      │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────────────────┐   │
│  │  Auth   │ │ Projects│ │Deployments│ │    Socket.IO Hub       │   │
│  │ Controller│ │ Controller│ │Controller│ │ (logs, status, notif)│   │
│  └─────────┘ └─────────┘ └─────────┘ └─────────────────────────┘   │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────────────────┐   │
│  │   GitHub│ │  Render │ │  Vercel │ │   Analyzer / Crypto     │   │
│  │ Service │ │ Service │ │ Service │ │   Service / Sanitizer   │   │
│  └─────────┘ └─────────┘ └─────────┘ └─────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
         │                        │                        │
         ▼                        ▼                        ▼
┌─────────────┐        ┌─────────────────┐      ┌─────────────────┐
│ PostgreSQL  │        │   Render API    │      │   Vercel API    │
│ (Prisma ORM)│        │   (Backend)     │      │   (Frontend)    │
└─────────────┘        └─────────────────┘      └─────────────────┘
```

### Data Flow

1. **User Authentication**: Email/password or GitHub OAuth → JWT issued
2. **Project Creation**: User provides GitHub repo → Project + Services created in DB
3. **Deployment Trigger**: Orchestrator starts 5-step pipeline
4. **Step 1 - Analysis**: Repository structure analyzed, services configured
5. **Step 2 - Render Deploy**: Backend provisioned on Render, deploy polled
6. **Step 3 - Health Check**: HTTP health check against Render backend
7. **Step 4 - Vercel Env**: `VITE_API_URL` injected into Vercel project
8. **Step 5 - Vercel Deploy**: Frontend built and deployed on Vercel
9. **Real-time**: All logs and status changes streamed via Socket.IO

---

## 🗄️ Database Schema (ER Diagram)

```
┌──────────────┐      ┌──────────────────┐      ┌─────────────────┐
│    users     │      │ oauth_accounts   │      │    projects     │
├──────────────┤      ├──────────────────┤      ├─────────────────┤
│ id (UUID PK) │      │ id (UUID PK)     │      │ id (UUID PK)    │
│ email (UK)   │────<│ user_id (FK)     │      │ user_id (FK)    │
│ password_hash│      │ provider         │      │ name            │
│ full_name    │      │ provider_user_id │      │ github_repo_url │
│ avatar_url   │      │ access_token_enc │      │ default_branch  │
│ created_at   │      │ created_at       │      │ detected_preset │
└──────────────┘      └──────────────────┘      └─────────────────┘
       │                       │                      │
       │                       │                      │
       │              ┌────────┴────────┐             │
       │              │                 │             │
       │      ┌──────────────┐  ┌──────────────┐     │
       │      │  projects    │  │  projects    │     │
       │      └──────────────┘  └──────────────┘     │
       │                                              │
       │                                  ┌───────────┴───────────┐
       │                                  │                       │
       │                          ┌──────────────┐      ┌──────────────┐
       │                          │ project_services│      │ env_variables│
       │                          ├──────────────┤      ├──────────────┤
       │                          │ id (UUID PK)   │      │ id (UUID PK) │
       │                          │ project_id (FK)│      │ project_id (FK)│
       │                          │ service_type   │      │ service_target │
       │                          │ provider       │      │ key            │
       │                          │ root_directory │      │ value_enc      │
       │                          │ build_command  │      │ is_secret      │
       │                          │ start_command  │      │ created_at     │
       │                          │ health_check_path│    └──────────────┘
       │                          └──────────────┘          ▲
       │                                                    │
       │                          ┌──────────────┐          │
       │                          │ deployments  │──────────┘
       │                          ├──────────────┤
       │                          │ id (UUID PK) │
       │                          │ project_id (FK)│
       │                          │ user_id (FK)   │
       │                          │ status         │
       │                          │ attempt_number │
       │                          │ retried_from_id│
       │                          │ render_service_id│
       │                          │ render_deploy_id │
       │                          │ vercel_project_id│
       │                          │ vercel_deploy_id │
       │                          │ backend_url      │
       │                          │ frontend_url     │
       │                          │ error_message    │
       │                          │ started_at       │
       │                          │ completed_at     │
       │                          └──────────────┘
       │                                                    │
       │                          ┌──────────────┐          │
       │                          │ deployment_logs│          │
       │                          ├──────────────┤          │
       │                          │ id (BIGSERIAL PK)│      │
       │                          │ deployment_id (FK)│    │
       │                          │ log_level        │    │
       │                          │ source           │    │
       │                          │ stage            │    │
       │                          │ message          │    │
       │                          │ created_at       │    │
       │                          └──────────────┘    │
       │                                                    │
       │                          ┌──────────────┐          │
       │                          │ deployment_steps│         │
       │                          ├──────────────┤          │
       │                          │ id (UUID PK)   │         │
       │                          │ deployment_id (FK)│     │
       │                          │ step_name        │     │
       │                          │ step_order       │     │
       │                          │ status           │     │
       │                          └──────────────┘         │
       │                                                    │
       │                          ┌──────────────┐          │
       │                          │ notifications │          │
       │                          ├──────────────┤          │
       │                          │ id (UUID PK)   │         │
       │                          │ user_id (FK)   │         │
       │                          │ type           │         │
       │                          │ title          │         │
       │                          │ message        │         │
       │                          │ is_read        │         │
       │                          │ created_at     │         │
       │                          └──────────────┘         │
```

### Analytical View

```
v_project_deployment_metrics
├── project_id, project_name
├── total_deployments
├── successful_deployments
├── failed_deployments
├── success_rate_percentage
├── avg_duration_seconds
├── last_deployment_date
└── moving_avg_duration_5 (window function)
```

---

## 📡 API Documentation

### Authentication

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/v1/auth/register` | Register new user | No |
| POST | `/api/v1/auth/login` | Login with email/password | No |
| GET | `/api/v1/auth/me` | Get current user profile | Yes (JWT) |
| GET | `/api/v1/auth/github/start` | Start GitHub OAuth sign-in | No |
| GET | `/api/v1/auth/github/connect/start` | Start GitHub OAuth connect (link to existing user) | Yes (JWT) |
| POST | `/api/v1/auth/github` | GitHub OAuth callback | Optional (JWT) |

### Projects

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/v1/projects` | List user's projects | Yes (JWT) |
| POST | `/api/v1/projects` | Create new project | Yes (JWT) |
| GET | `/api/v1/projects/:id` | Get project with services, env vars, deployments | Yes (JWT) |
| GET | `/api/v1/projects/analytics` | Deployment metrics (SQL view) | Yes (JWT) |

### Environment Variables

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/v1/projects/:id/env` | List environment variables | Yes (JWT) |
| POST | `/api/v1/projects/:id/env` | Add environment variable | Yes (JWT) |
| DELETE | `/api/v1/projects/:id/env/:envId` | Delete environment variable | Yes (JWT) |

### Deployments

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/v1/projects/deployments/trigger` | Trigger new deployment | Yes (JWT) |
| POST | `/api/v1/projects/deployments/:id/retry` | Retry failed deployment | Yes (JWT) |
| GET | `/api/v1/projects/deployments/:id` | Get deployment details | Yes (JWT) |
| GET | `/api/v1/projects/:projectId/deployments` | List project deployments | Yes (JWT) |

### GitHub

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/v1/github/repos` | List user's GitHub repositories | Yes (JWT) |

### Health

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/v1/health` | Server health status | No |
| GET | `/api/v1/health/db` | Database connection status | No |

### Notifications

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/v1/notifications` | List user's notifications | Yes (JWT) |
| POST | `/api/v1/notifications/:id/read` | Mark notification as read | Yes (JWT) |

### Socket.IO Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `connect` | Client→Server | Authenticate with JWT token |
| `disconnect` | Client→Server | Disconnect |
| `deployment:join` | Client→Server | Join deployment room for live logs |
| `deployment:status_changed` | Server→Client | Deployment status transition |
| `deployment:log` | Server→Client | Live deployment log entry |
| `deployment:step_update` | Server→Client | Deployment step status change |
| `deployment:completed` | Server→Client | Deployment fully completed |
| `notification:new` | Server→Client | New notification received |

---

## 🔄 Deployment Workflow

### Pipeline Steps

```
1. Repository Inspection (GitHub)
   └─ Analyze repo structure, detect frontend/backend
2. Backend Build & Deploy (Render)
   └─ Create/Update Render web service
   └─ Poll deploy status until live
3. Backend Health Verification (Render)
   └─ HTTP health check against Render backend URL
4. Environment URL Injection (Vercel)
   └─ Ensure Vercel project exists
   └─ Inject VITE_API_URL = backend URL
   └─ Propagate other frontend/shared env vars
5. Frontend Build & Deploy (Vercel)
   └─ Trigger Vercel deployment
   └─ Poll until READY state
```

### Retry Logic

- Only failed deployments can be retried
- Retry creates a new deployment record with incremented `attempt_number`
- `retried_from_id` links to the original deployment
- Existing Render services are reused (no duplicate provisioning)
- Deployment notifications sent on retry start

### Security

- All provider API keys stored server-side only
- OAuth tokens encrypted with AES-256-GCM before storage
- Environment variable values encrypted at rest
- Production mode suppresses detailed error messages
- Rate limiting on auth and OAuth endpoints
- Input validation on all API endpoints
- CORS restricted to trusted origins
- Security headers (HSTS in production)

---

## 🔒 Security Considerations

### Authentication
- JWT access tokens with 7-day expiration
- Passwords hashed with bcrypt (10 salt rounds)
- Optional authentication middleware for OAuth callback (supports both sign-in and connect flows)
- User ownership enforced on all project/deployment/env endpoints

### Data Protection
- OAuth access tokens encrypted with AES-256-GCM before database storage
- Environment variable values encrypted at rest
- Secrets never logged or returned in API responses
- Provider error messages sanitized (secrets/tokens redacted)

### Input Validation
- UUID validation for all resource IDs
- String length limits on all text fields
- GitHub URL format validation
- Health check path must start with `/`
- Build/start commands validated for non-empty strings

### Production Configuration
- `NODE_ENV=production` required
- `DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY` must be set to non-default values
- `RENDER_API_KEY`, `VERCEL_API_KEY` required for real deployments
- `ALLOW_SIMULATED_DEPLOYMENTS` must NOT be set to `true` in production
- HSTS header enabled in production
- `trust proxy` enabled in production

---

## 🧪 Test Report

### Test Suites (All Passing)

| Test Suite | Tests | Passed | Failed |
|------------|-------|--------|--------|
| GitHub OAuth Connect | 13 | 13 | 0 |
| GitHub Repository Listing | 4 | 4 | 0 |
| GitHub OAuth Error Handling | 7 | 7 | 0 |
| GitHub OAuth Duplicate Exchange | 5 | 5 | 0 |
| Render Deployment Failure | 11 | 11 | 0 |
| **Total** | **40** | **40** | **0** |

### Test Coverage

- ✅ OAuth connect start (auth required, signed state)
- ✅ OAuth callback (valid JWT, state-embedded userId, invalid state, expired state)
- ✅ OAuth error handling (bad_verification_code, redirect_uri_mismatch, generic errors)
- ✅ Duplicate code exchange prevention
- ✅ Ownership isolation (user A cannot connect to user B's account)
- ✅ OAuth re-linking (GitHub account moved from prior user to current user)
- ✅ GitHub repo listing (connected, not-connected, empty, API failures)
- ✅ No demo/starter repositories anywhere
- ✅ Render API error sanitization (HTTP 400 capture, secret redaction)
- ✅ Backend service config validation
- ✅ Retry deduplication (no duplicate Render services)
- ✅ Web production build (2206 modules, ~371KB JS)

### Running Tests

```bash
# Run all server tests
cd server
node test-github-connect.js
node test-github-repos.js
node test-github-oauth-errors.js
node test-github-oauth-duplicate.js
node test-render-failure.js

# Web production build
cd apps/web
npx vite build
```

---

## ⚠️ Known Limitations

1. **Real Deployments**: Requires valid `RENDER_API_KEY` and `VERCEL_API_KEY` in `server/.env`. Without these, deployments cannot proceed past the Render provisioning step.

2. **Electron OAuth Context**: GitHub OAuth opens in the system browser (Chrome). The Electron app syncs connection state via `window.focus`/`visibilitychange` events when the Electron window regains focus.

3. **Simulated Deployment Mode**: `ALLOW_SIMULATED_DEPLOYMENTS=true` is development-only and clearly labeled in logs. Never enable in production.

4. **GitHub OAuth App**: Callback URL must match `http://localhost:5173/auth/callback` for development. For production, update to your production domain.

5. **Database**: Requires PostgreSQL with `uuid-ossp` and `pgcrypto` extensions.

---

## 📖 Project Demonstration Instructions

### Web Application Demo

1. **Start the server**: `cd server && npm run dev`
2. **Start the web app**: `cd apps/web && npm run dev`
3. **Open browser**: http://localhost:5173
4. **Register/Login**: Create an account or log in
5. **Connect GitHub**: Click "Connect GitHub" on New Deployment page
6. **Create Project**: Enter GitHub repo URL, select backend/frontend directories
7. **Deploy**: Click "Deploy Latest Commit" to start the pipeline
8. **Monitor**: Watch live logs and status transitions in real time
9. **View Results**: Check backend URL, frontend URL, and deployment history

### Electron Desktop Demo

1. **Start the server**: `cd server && npm run dev`
2. **Start the web dev server**: `cd apps/web && npm run dev`
3. **Start Electron**: `cd apps/desktop && npm run dev:desktop`
4. **Login**: Email/password authentication
5. **Connect GitHub**: Click "Connect GitHub" - opens system browser
6. **Sync**: Return to Electron window after OAuth completes - connection state syncs automatically
7. **Deploy**: Full deployment pipeline from desktop

### Commands Summary

```bash
# Install
npm install

# Configure
cp .env.example .env
# Edit server/.env with your API keys

# Database
psql -U postgres -d deplo_ai -f database/schema.sql

# Run
npm run dev              # Server + Web
npm run dev:desktop      # Electron

# Build web
cd apps/web && npx vite build

# Test
cd server && node test-github-connect.js
```

---

## 📄 License

ISC License

---

*Built as a major college project demonstrating full-stack web development, SQL database design, real-time communication, desktop application development, and cloud deployment orchestration.*
