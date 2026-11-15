# deplo.ai — REST API Specification

> **Base URL:** `http://localhost:5001/api/v1`  
> **Protocols:** HTTPS / REST, WebSocket (Socket.IO)  
> **Authentication:** Bearer Token (JSON Web Token)  

---

## 1. Authentication Endpoints (`/auth`)

### 1.1 Register User
- **Method:** `POST`
- **Endpoint:** `/api/v1/auth/register`
- **Access:** Public
- **Request Body:**
```json
{
  "fullName": "Alex Cloud Architect",
  "email": "developer@deplo.ai",
  "password": "StrongPassword123!"
}
```
- **Response (201 Created):**
```json
{
  "success": true,
  "message": "Account created successfully.",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "d5dc5fae-eb5a-493f-9805-f2f1a157b0c9",
      "email": "developer@deplo.ai",
      "fullName": "Alex Cloud Architect",
      "createdAt": "2026-11-12T10:00:00.000Z"
    }
  }
}
```

### 1.2 Login User
- **Method:** `POST`
- **Endpoint:** `/api/v1/auth/login`
- **Access:** Public
- **Request Body:**
```json
{
  "email": "developer@deplo.ai",
  "password": "StrongPassword123!"
}
```
- **Response (200 OK):**
```json
{
  "success": true,
  "message": "Logged in successfully.",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "d5dc5fae-eb5a-493f-9805-f2f1a157b0c9",
      "email": "developer@deplo.ai",
      "fullName": "Alex Cloud Architect"
    }
  }
}
```

### 1.3 Get Authenticated Profile
- **Method:** `GET`
- **Endpoint:** `/api/v1/auth/me`
- **Headers:** `Authorization: Bearer <token>`
- **Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "d5dc5fae-eb5a-493f-9805-f2f1a157b0c9",
    "email": "developer@deplo.ai",
    "fullName": "Alex Cloud Architect",
    "hasGithubConnected": true,
    "_count": { "projects": 3 }
  }
}
```

---

## 2. GitHub & Analysis Endpoints (`/github`)

### 2.1 List Accessible Repositories
- **Method:** `GET`
- **Endpoint:** `/api/v1/github/repos`
- **Headers:** `Authorization: Bearer <token>`
- **Response (200 OK):**
```json
{
  "success": true,
  "source": "GITHUB_OAUTH",
  "data": [
    {
      "id": 101,
      "name": "ecommerce-portal",
      "fullName": "alex-dev/ecommerce-portal",
      "url": "https://github.com/alex-dev/ecommerce-portal",
      "defaultBranch": "main",
      "language": "TypeScript"
    }
  ]
}
```

### 2.2 Analyze Repository Architecture
- **Method:** `POST`
- **Endpoint:** `/api/v1/github/analyze`
- **Headers:** `Authorization: Bearer <token>`
- **Request Body:**
```json
{
  "repoUrl": "https://github.com/alex-dev/ecommerce-portal",
  "branch": "main"
}
```
- **Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "detectedPreset": "REACT_VITE",
    "repository": {
      "fullName": "alex-dev/ecommerce-portal",
      "branch": "main",
      "isMonorepo": true
    },
    "orchestrationPlan": {
      "deploymentOrder": ["BACKEND", "HEALTH_CHECK", "ENV_INJECTION", "FRONTEND"]
    },
    "backend": {
      "provider": "RENDER",
      "framework": "EXPRESS_NODE",
      "rootDirectory": "/server",
      "buildCommand": "npm install",
      "startCommand": "npm start",
      "healthCheckPath": "/api/health"
    },
    "frontend": {
      "provider": "VERCEL",
      "framework": "REACT_VITE",
      "rootDirectory": "/client",
      "buildCommand": "npm run build",
      "startCommand": "npm run preview"
    }
  }
}
```

---

## 3. Project & Deployment Endpoints (`/projects`)

### 3.1 List Projects
- **Method:** `GET`
- **Endpoint:** `/api/v1/projects`
- **Headers:** `Authorization: Bearer <token>`

### 3.2 Create Project
- **Method:** `POST`
- **Endpoint:** `/api/v1/projects`
- **Headers:** `Authorization: Bearer <token>`
- **Request Body:**
```json
{
  "name": "ecommerce-portal",
  "githubRepoFullName": "alex-dev/ecommerce-portal",
  "githubRepoUrl": "https://github.com/alex-dev/ecommerce-portal",
  "defaultBranch": "main",
  "detectedPreset": "REACT_VITE",
  "backendService": {
    "rootDirectory": "/server",
    "buildCommand": "npm install",
    "startCommand": "npm start",
    "healthCheckPath": "/api/health"
  },
  "frontendService": {
    "rootDirectory": "/client",
    "buildCommand": "npm run build",
    "startCommand": "npm run preview"
  }
}
```

### 3.3 Trigger Deployment Pipeline
- **Method:** `POST`
- **Endpoint:** `/api/v1/projects/deployments/trigger`
- **Headers:** `Authorization: Bearer <token>`
- **Request Body:**
```json
{
  "projectId": "b0000000-0000-0000-0000-000000000001",
  "commitMessage": "feat: launch payment gateway"
}
```
- **Response (201 Created):**
```json
{
  "success": true,
  "message": "Deployment pipeline initiated.",
  "data": {
    "id": "50190392-cdba-4220-b637-86f6feadbd6e",
    "status": "ANALYZING",
    "commitHash": "main-head"
  }
}
```

### 3.4 Get Live Deployment Status & Logs
- **Method:** `GET`
- **Endpoint:** `/api/v1/projects/deployments/:id`
- **Headers:** `Authorization: Bearer <token>`

---

## 4. Real-Time Socket.IO Events

| Event Name | Direction | Payload | Description |
| :--- | :--- | :--- | :--- |
| `join_deployment` | Client $\rightarrow$ Server | `{ deploymentId: "UUID" }` | Subscribes client to live build logs for deployment. |
| `leave_deployment` | Client $\rightarrow$ Server | `{ deploymentId: "UUID" }` | Leaves deployment room. |
| `deployment_log` | Server $\rightarrow$ Client | `{ stage, message, logLevel, timestamp }` | Live stdout/stderr log chunk emitted to terminal. |
| `deployment_status_changed` | Server $\rightarrow$ Client | `{ status, backendUrl, frontendUrl }` | Notifies clients of state machine transition. |
| `deployment_step_update` | Server $\rightarrow$ Client | `{ stepId, order, status }` | Updates step status in progress checklist. |
| `deployment_completed` | Server $\rightarrow$ Client | `{ id, status, durationSeconds, urls }` | Emitted when deployment completes successfully. |

