-- ==============================================================================
-- deplo.ai — PostgreSQL Schema DDL (Pure SQL for College Evaluation)
-- Course Requirements: Primary/Foreign Keys, Checks, Indexes, Views, Aggregations
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255),
    full_name VARCHAR(100) NOT NULL,
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. OAuth Accounts (GitHub connection)
CREATE TABLE IF NOT EXISTS oauth_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL,
    provider_user_id VARCHAR(100) NOT NULL,
    access_token_enc TEXT NOT NULL,
    refresh_token_enc TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(provider, provider_user_id)
);

-- 3. Projects Table
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    github_repo_full_name VARCHAR(255) NOT NULL,
    github_repo_url TEXT NOT NULL,
    default_branch VARCHAR(50) DEFAULT 'main',
    detected_preset VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Project Services (Frontend / Backend specs)
CREATE TABLE IF NOT EXISTS project_services (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    service_type VARCHAR(20) NOT NULL CHECK (service_type IN ('BACKEND', 'FRONTEND', 'DATABASE')),
    provider VARCHAR(30) NOT NULL CHECK (provider IN ('RENDER', 'VERCEL', 'GITHUB')),
    root_directory VARCHAR(255) DEFAULT '/',
    framework VARCHAR(50),
    build_command VARCHAR(255),
    start_command VARCHAR(255),
    output_directory VARCHAR(255),
    health_check_path VARCHAR(255) DEFAULT '/health',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, service_type)
);

-- 5. Environment Variables
CREATE TABLE IF NOT EXISTS environment_variables (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    service_target VARCHAR(20) NOT NULL CHECK (service_target IN ('BACKEND', 'FRONTEND', 'SHARED')),
    key VARCHAR(100) NOT NULL,
    value_enc TEXT NOT NULL,
    is_secret BOOLEAN DEFAULT true,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, service_target, key)
);

-- 6. Deployments Table
CREATE TABLE IF NOT EXISTS deployments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    status VARCHAR(30) NOT NULL DEFAULT 'QUEUED' 
        CHECK (status IN ('QUEUED', 'ANALYZING', 'DEPLOYING_BACKEND', 'HEALTH_CHECKING', 'DEPLOYING_FRONTEND', 'SUCCESS', 'FAILED', 'CANCELLED')),
    attempt_number INTEGER NOT NULL DEFAULT 1,
    retried_from_id UUID NULL REFERENCES deployments(id) ON DELETE SET NULL,
    commit_hash VARCHAR(40),
    commit_message TEXT,
    triggered_by VARCHAR(50) DEFAULT 'MANUAL',
    backend_url TEXT,
    frontend_url TEXT,
    render_service_id VARCHAR(255),
    render_deploy_id VARCHAR(255),
    vercel_project_id VARCHAR(255),
    vercel_deploy_id VARCHAR(255),
    duration_seconds INTEGER,
    error_message TEXT,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE
);

-- 7. Deployment Execution Steps
CREATE TABLE IF NOT EXISTS deployment_steps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    deployment_id UUID NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
    step_name VARCHAR(100) NOT NULL,
    provider VARCHAR(30),
    external_deploy_id VARCHAR(255),
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'SKIPPED')),
    step_order INTEGER NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE
);

-- 8. Deployment Logs
CREATE TABLE IF NOT EXISTS deployment_logs (
    id BIGSERIAL PRIMARY KEY,
    deployment_id UUID NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
    log_level VARCHAR(10) DEFAULT 'INFO' CHECK (log_level IN ('DEBUG', 'INFO', 'WARN', 'ERROR')),
    source VARCHAR(20) NOT NULL DEFAULT 'ORCHESTRATOR' CHECK (source IN ('ORCHESTRATOR', 'PROVIDER')),
    stage VARCHAR(50) NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 9. User Notifications (persistent)
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    deployment_id UUID NULL REFERENCES deployments(id) ON DELETE SET NULL,
    project_id UUID NULL REFERENCES projects(id) ON DELETE SET NULL,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_deployments_project_id ON deployments(project_id);
CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status);
CREATE INDEX IF NOT EXISTS idx_deployments_retried_from_id ON deployments(retried_from_id);
CREATE INDEX IF NOT EXISTS idx_deployments_started_at ON deployments(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_deployment_logs_dep_id ON deployment_logs(deployment_id);
CREATE INDEX IF NOT EXISTS idx_deployment_steps_dep_id ON deployment_steps(deployment_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_deployment_id ON notifications(deployment_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);

-- ==============================================================================
-- College Requirement: Database View demonstrating CTE, Aggregations & Window Functions
-- ==============================================================================
CREATE OR REPLACE VIEW v_project_deployment_metrics AS
WITH deployment_durations AS (
    SELECT 
        d.id,
        d.project_id,
        d.status,
        d.started_at,
        EXTRACT(EPOCH FROM (COALESCE(d.completed_at, CURRENT_TIMESTAMP) - d.started_at))::INT AS calculated_duration,
        ROW_NUMBER() OVER (PARTITION BY d.project_id ORDER BY d.started_at DESC) as recency_rank,
        AVG(EXTRACT(EPOCH FROM (COALESCE(d.completed_at, CURRENT_TIMESTAMP) - d.started_at))) OVER (
            PARTITION BY d.project_id 
            ORDER BY d.started_at 
            ROWS BETWEEN 4 PRECEDING AND CURRENT ROW
        ) as moving_avg_duration_5
    FROM deployments d
)
SELECT 
    p.id AS project_id,
    p.name AS project_name,
    COUNT(d.id) AS total_deployments,
    COUNT(CASE WHEN d.status = 'SUCCESS' THEN 1 END) AS successful_deployments,
    COUNT(CASE WHEN d.status = 'FAILED' THEN 1 END) AS failed_deployments,
    ROUND(
        (COUNT(CASE WHEN d.status = 'SUCCESS' THEN 1 END)::NUMERIC / NULLIF(COUNT(d.id), 0)) * 100, 
        2
    ) AS success_rate_percentage,
    ROUND(AVG(dd.calculated_duration), 1) AS avg_duration_seconds,
    MAX(d.started_at) AS last_deployment_date
FROM projects p
LEFT JOIN deployments d ON p.id = d.project_id
LEFT JOIN deployment_durations dd ON d.id = dd.id
GROUP BY p.id, p.name;

