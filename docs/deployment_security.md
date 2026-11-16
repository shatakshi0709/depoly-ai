# deplo.ai — Deployment Security & Credential Management Architecture

> **Author:** Aridaman Singh (Deployment & Cloud Orchestration Lead)  
> **Security Level:** Production / High-Assurance  

---

## 1. Zero-Trust Credential Isolation

The deplo.ai deployment engine follows defense-in-depth principles to ensure API tokens, database credentials, and secret environment variables are never exposed:

### 1.1 Envelope Encryption at Rest
All user-configured environment variables (`EnvironmentVariable` model) are encrypted prior to database insertion:
* **Algorithm:** AES-256-GCM (Galois/Counter Mode) authenticated encryption.
* **Key Derivation:** Configured via `ENCRYPTION_KEY` in environment variables.
* **Integrity Guarantee:** Any tampering with the ciphertext causes immediate decryption rejection via the authentication tag.

### 1.2 Automated Redaction in Log Streaming
All log events passed through `sanitizeLogMessage()` before broadcast over Server-Sent Events or WebSockets:
* **Bearer Tokens:** `Bearer [REDACTED]`
* **GitHub Personal Access Tokens:** `ghp_[REDACTED]`, `gho_[REDACTED]`
* **Render API Keys:** `rnd_[REDACTED]`
* **Vercel API Tokens:** `vcp_[REDACTED]`
* **Arbitrary Key-Value Passwords:** `password=[REDACTED]`, `secret=[REDACTED]`

---

## 2. API Gateway Protection

### 2.1 Rate Limiting
All deployment endpoints are rate-limited via sliding memory counters (`src/middleware/rateLimit.js`):
* `POST /api/deploy` — Max 10 requests per minute per IP.
* `POST /api/deploy/:id/retry` — Max 10 retry requests per minute.

### 2.2 Input Sanitization & Anti-Traversal
* All directory paths are validated against `validRelativeDirectory`:
  * Rejects relative parent traversal segments (`..`).
  * Rejects control characters (`\x00-\x1f`).
  * Caps path length at 255 characters.
* Project names and slugs sanitized via `generateProjectSlug` to prevent header injection and DNS poisoning.

---

## 3. Compliance & Auditability

Every deployment operation maintains an immutable audit trail:
* User identity (`triggeredBy`) recorded on the deployment model.
* Per-step execution timestamps (`startedAt`, `completedAt`).
* External cloud provider identifiers (`renderServiceId`, `renderDeployId`, `vercelProjectId`, `vercelDeployId`) tracked for cloud-side reconciliation.
