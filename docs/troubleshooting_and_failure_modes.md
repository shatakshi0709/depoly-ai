# deplo.ai — Cloud Deployment Troubleshooting & Failure Recovery Playbook

> **Author:** Aridaman Singh (Deployment & Cloud Orchestration Lead)  
> **Audience:** DevOps Engineers, Evaluators, Full-Stack Developers  
> **Applies to:** Express Orchestrator, Render API, Vercel API, PostgreSQL  

---

## 1. Quick Diagnostic Checklist

When troubleshooting a stalled or failed deployment:
1. Check the deployment status via `GET /api/deploy/:id`.
2. Inspect the live SSE stream or fetch logs via `GET /api/deploy/:id/logs`.
3. Check the HTTP health endpoint via `GET /api/deploy/:id/health`.
4. Export the complete plain-text log via `GET /api/deploy/:id/logs/download`.

---

## 2. Common Failure Modes & Resolution Steps

### 2.1 Backend Provisioning Failure (Render)
* **Symptom:** Step 2 fails with `Render API provisioning failed: HTTP 400` or `RENDER_OWNER_ID is required`.
* **Root Cause:**
  * Render API token missing or expired.
  * Account has multiple workspaces and none was explicitly configured.
* **Resolution:**
  1. Retrieve your Render Workspace ID from your Render Dashboard -> Account Settings.
  2. Set `RENDER_OWNER_ID="tea-..."` in `server/.env`.
  3. Ensure `RENDER_API_KEY="rnd_..."` has write permissions.

### 2.2 Backend Health Verification Timeout
* **Symptom:** Step 3 times out after 20 retries with `Backend health check failed`.
* **Root Cause:**
  * Application took longer than expected to boot (cold start).
  * Backend bound to `localhost` (`127.0.0.1`) instead of `0.0.0.0`.
  * Port mismatch (Render expects service to listen on `process.env.PORT`).
* **Resolution:**
  * Ensure backend binds to `0.0.0.0`:
    ```javascript
    server.listen(process.env.PORT || 10000, '0.0.0.0', () => ...);
    ```
  * Verify the health endpoint (`/health` or `/api/v1/health`) returns HTTP 200 without requiring authentication.

### 2.3 Vercel Subdirectory Build Failure (`[STATIC_BUILD_NO_OUT_DIR]`)
* **Symptom:** Step 5 fails with `No Output Directory named dist found`.
* **Root Cause:**
  * Frontend code resides in a subfolder (e.g., `client/` or `frontend/`), but root directory was not mapped.
* **Resolution:**
  * `ensureVercelProject` automatically configures `rootDirectory` and `outputDirectory: dist`.
  * If building manually, verify `frontend.rootDirectory` is specified without leading slash traversal (`..`).

### 2.4 Cross-Origin Resource Sharing (CORS) Block
* **Symptom:** Frontend application displays `Network Error` or `Blocked by CORS policy` when communicating with backend.
* **Root Cause:**
  * Backend CORS allowed origins list does not contain the dynamic Vercel deployment URL.
* **Resolution:**
  * Handled automatically in Step 7: the orchestrator queries the live Vercel URL, appends its origin to `CORS_ORIGINS`, updates Render via `upsertRenderServiceEnvVar`, and triggers a zero-downtime rolling restart.

---

## 3. Emergency Operations

### 3.1 Cancellation
To immediately halt a runaway or hung deployment:
```bash
curl -X POST http://localhost:5001/api/deploy/{DEPLOYMENT_ID}/cancel \
  -H "Authorization: Bearer {TOKEN}"
```

### 3.2 Rollback
To instantly trigger a redeployment of the most recent stable deployment:
```bash
curl -X POST http://localhost:5001/api/deploy/{DEPLOYMENT_ID}/rollback \
  -H "Authorization: Bearer {TOKEN}"
```

### 3.3 Simulation Mode (Demo & Offline Presentations)
If live cloud provider API keys are unavailable, enable labeled simulation:
```env
ALLOW_SIMULATED_DEPLOYMENTS=true
```
In simulation mode:
* All operations simulate provider latency realistically.
* Logs are clearly tagged with `[SIMULATED]` in full compliance with presentation integrity rules.
* Health checks simulate successful HTTP 200 responses.
