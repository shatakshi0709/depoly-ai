# deplo.ai — Major Project Defense & Viva Preparation Guide

> **Project Title:** deplo.ai — AI-Assisted Deployment & Cloud Orchestration Platform  
> **Evaluated Subjects:** Web Development • SQL Database • Interactive System Development  

---

## 1. Project Overview & Elevator Pitch

### What is deplo.ai?
`deplo.ai` is an automated multi-cloud deployment orchestrator designed to eliminate manual configuration when shipping full-stack applications. A developer connects their GitHub repository; `deplo.ai` scans the codebase, identifies the backend and frontend components, provisions the backend on **Render**, verifies its health via automated HTTP polling, automatically injects the live backend URL into the frontend environment (`VITE_API_URL`), and deploys the frontend to **Vercel**.

### What problem does it solve?
Deploying full-stack applications manually requires multiple dashboards, manual copying of API URLs, synchronization of environment variables, and manual monitoring. `deplo.ai` automates this sequence into a single, unified pipeline with real-time log streaming to both Web and Desktop interfaces.

---

## 2. Subject 1: Web Development (Viva Q&A)

### Q1: Why did you choose React with Vite instead of Create React App (CRA)?
**Answer:**
- **Build Speed & HMR:** Vite utilizes native ES modules (`<script type="module">`) and the ultra-fast Go-based `esbuild` pre-bundler. This eliminates the sluggish rebuild times of Webpack in CRA.
- **Rollup for Production:** Vite uses Rollup for highly optimized, tree-shaken production bundles with code splitting and asset hashing.

### Q2: How does the application handle real-time log streaming?
**Answer:**
We implemented **Socket.IO over WebSockets**.
- When viewing a deployment, the client emits `join_deployment` with the `deploymentId`, joining a dedicated Socket.IO room.
- The server pushes stdout/stderr log chunks and state transitions (`DEPLOYING_BACKEND`, `HEALTH_CHECKING`, etc.) directly to room subscribers.
- This eliminates polling overhead, provides sub-millisecond log updates, and supports bidirectional communication.

### Q3: How is client authentication secured?
**Answer:**
- Stateless **JSON Web Tokens (JWT)** signed using HMAC SHA-256 with an expiration of 7 days.
- Passwords are salted and hashed using **bcryptjs** (10 salt rounds).
- Axios request interceptors automatically inject `Authorization: Bearer <token>` into HTTP headers.
- Protected routes in React redirect unauthenticated users to `/login`.

---

## 3. Subject 2: SQL Database & PostgreSQL (Viva Q&A)

### Q1: Can you explain the Database Schema and its Normalization?
**Answer:**
The schema is normalized to **Third Normal Form (3NF)**:
1. **Users (`users`):** Stores credentials and profile metadata.
2. **OAuth Accounts (`oauth_accounts`):** 1-to-many relationship with Users, storing encrypted GitHub access tokens.
3. **Projects (`projects`):** 1-to-many relationship with Users with cascade delete (`ON DELETE CASCADE`).
4. **Project Services (`project_services`):** Normalized child table representing backend (Render) and frontend (Vercel) configurations.
5. **Environment Variables (`environment_variables`):** Key-value table storing AES-256 encrypted variables scoped to `SHARED`, `BACKEND`, or `FRONTEND`.
6. **Deployments (`deployments`):** Tracks pipeline runs, commit hashes, URLs, and statuses.
7. **Deployment Steps (`deployment_steps`):** Granular tracking of individual pipeline stages.
8. **Deployment Logs (`deployment_logs`):** Append-only log storage with indexed foreign keys.

### Q2: What advanced SQL features did you implement to satisfy the curriculum?
**Answer:**
1. **Database View with Window Functions (`v_project_deployment_metrics`):**
   - Uses Common Table Expressions (CTE).
   - Computes `ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY started_at DESC)` for recency ranking.
   - Computes a 5-run moving average of deployment durations: `AVG(duration) OVER (PARTITION BY project_id ORDER BY started_at ROWS BETWEEN 4 PRECEDING AND CURRENT ROW)`.
   - Uses `COUNT()`, `ROUND()`, `NULLIF()`, and conditional aggregation (`COUNT(CASE WHEN status = 'SUCCESS' THEN 1 END)`).
2. **ACID Transactions:**
   - Atomic multi-table inserts when triggering a deployment (creating the `Deployment`, 5 `DeploymentStep` records, and initial log in a single `BEGIN ... COMMIT` block).
3. **B-Tree Indexes:**
   - Placed on foreign keys (`user_id`, `project_id`, `deployment_id`) and high-cardinality status columns (`status`) to ensure $O(\log n)$ search performance.

---

## 4. Subject 3: Interactive System Development & Electron (Viva Q&A)

### Q1: What is Electron's Multi-Process Architecture?
**Answer:**
Electron separates execution into two distinct process types:
1. **Main Process (`main.js`):**
   - Runs in a full Node.js environment.
   - Manages operating system interactions, window lifecycles (`BrowserWindow`), native menus, system tray, and native OS notifications (`new Notification()`).
2. **Renderer Process (`renderer/`):**
   - Runs the React UI inside Chromium.
   - Responsible strictly for DOM rendering and user interaction.

### Q2: How did you secure the Electron application?
**Answer:**
We followed modern Electron security guidelines:
- `nodeIntegration: false`: Renderer cannot directly invoke Node system calls (like `fs`, `child_process`).
- `contextIsolation: true`: Isolates Chromium JavaScript execution contexts from Electron internals.
- **Preload Script (`preload.js`):** Uses `contextBridge.exposeInMainWorld('electronAPI', { ... })` to expose only safe, whitelisted IPC communication channels (`showNotification`, `updateBadge`, `getSystemInfo`).

### Q3: What native desktop features are demonstrated in deplo.ai?
**Answer:**
- **Native OS Desktop Notifications:** Displays system banners when deployments finish or fail, even when the app is minimized.
- **macOS Dock Badges:** Displays dynamic error badges on the dock icon when pipelines encounter errors.
- **System Diagnostics IPC:** Queries CPU architecture, OS platform, and RAM utilization via `ipcRenderer.invoke`.

---

## 5. Live Demonstration Script (Step-by-Step for Presentation)

1. **Start the Platform:**
   - Terminal: `npm run dev` (starts Express API Gateway on `5001` and Vite Web Dashboard on `5173`).
2. **Demonstrate Web App:**
   - Open `http://localhost:5173`.
   - Show User Registration & Login with bcrypt and JWT.
   - View Dashboard metrics powered by the PostgreSQL `v_project_deployment_metrics` view.
3. **Demonstrate Heuristic Repository Analysis (Phase 7):**
   - Click **"New Project"**.
   - Select a full-stack starter repo (or enter any GitHub URL).
   - Click **"Analyze Architecture"**: Show automated detection of `/server` (Express) and `/client` (Vite React).
4. **Trigger Chained Multi-Cloud Deployment:**
   - Click **"Confirm & Deploy Pipeline"**.
   - Watch the live step checklist:
     - Step 1: Repository Inspection
     - Step 2: Render Backend Deploy
     - Step 3: Health Verification (HTTP 200)
     - Step 4: Environment URL Injection (`VITE_API_URL`)
     - Step 5: Vercel Frontend Deploy
   - Watch live log terminal stream chunks via Socket.IO.
5. **Demonstrate Electron Desktop Experience:**
   - In terminal: `npm run dev:desktop`.
   - Trigger a deployment inside the desktop window and minimize it.
   - Observe the **Native OS Desktop Notification** appear with audio when the deployment succeeds!
