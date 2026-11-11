# deplo.ai 🚀

> **AI-Assisted Deployment & Cloud Orchestration Platform**  
> *Major College Project: Web Development • SQL Database • Interactive System Development*

---

## 📌 Project Overview
`deplo.ai` automates the complex multi-cloud deployment lifecycle of modern full-stack applications. By connecting to a developer's GitHub repository, `deplo.ai`:
1. Analyzes the repository structure to identify frontend and backend components.
2. Recommends tailored deployment commands and environment configurations.
3. Deploys the backend first via **Render**.
4. Continuously verifies backend health via HTTP health checks.
5. Automatically provisions and injects the live backend URL into the frontend environment.
6. Builds and deploys the frontend via **Vercel**.
7. Streams live build logs and state transitions in real time to both **Web** and **Desktop (Electron)** applications.

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

---

## 🛠️ Prerequisites
- **Node.js**: v18.0.0 or higher (v20+ recommended)
- **PostgreSQL**: v14.0 or higher
- **Git**
- **Cloud Accounts**: GitHub, Render (Free tier), Vercel (Hobby tier)

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
Update `DATABASE_URL`, `JWT_SECRET`, and API keys as required.

### 3. Run Applications
- Run Express Server: `npm run dev:server`
- Run Web Application: `npm run dev:web`
- Run Desktop Application: `npm run dev:desktop`
