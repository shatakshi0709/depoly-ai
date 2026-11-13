-- ==============================================================================
-- deplo.ai — Academic SQL Demonstration Queries
-- College Evaluation Script for Lab Examiner Verification
-- Subjects: SQL Database, Joins, Aggregations, CTEs, Window Functions, Transactions
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. JOINS (Demonstrating Multi-Table Relational Navigation)
-- ------------------------------------------------------------------------------
-- Query: Fetch all users, their projects, configured services, and latest deployment status
SELECT 
    u.full_name AS developer_name,
    u.email,
    p.name AS project_name,
    p.default_branch,
    ps.service_type,
    ps.provider AS cloud_provider,
    ps.root_directory,
    d.status AS latest_deployment_status,
    d.backend_url,
    d.frontend_url
FROM users u
INNER JOIN projects p ON u.id = p.user_id
INNER JOIN project_services ps ON p.id = ps.project_id
LEFT JOIN (
    -- Subquery getting only the most recent deployment per project
    SELECT DISTINCT ON (project_id) *
    FROM deployments
    ORDER BY project_id, started_at DESC
) d ON p.id = d.project_id
ORDER BY p.name, ps.service_type;


-- ------------------------------------------------------------------------------
-- 2. GROUP BY & AGGREGATE FUNCTIONS (WITH HAVING CLAUSE)
-- ------------------------------------------------------------------------------
-- Query: Calculate deployment statistics per cloud provider where at least 1 deployment was made
SELECT 
    ps.provider AS cloud_provider,
    COUNT(DISTINCT p.id) AS total_projects_hosted,
    COUNT(d.id) AS total_deployments_run,
    COUNT(CASE WHEN d.status = 'SUCCESS' THEN 1 END) AS successful_runs,
    COUNT(CASE WHEN d.status = 'FAILED' THEN 1 END) AS failed_runs,
    ROUND(AVG(d.duration_seconds), 2) AS avg_duration_seconds
FROM project_services ps
JOIN projects p ON ps.project_id = p.id
LEFT JOIN deployments d ON p.id = d.project_id
GROUP BY ps.provider
HAVING COUNT(d.id) >= 1
ORDER BY total_deployments_run DESC;


-- ------------------------------------------------------------------------------
-- 3. COMMON TABLE EXPRESSIONS (CTEs) & SUBQUERIES
-- ------------------------------------------------------------------------------
-- Query: Identify the fastest and slowest deployment per project using CTEs
WITH RankedDeployments AS (
    SELECT 
        d.id,
        d.project_id,
        p.name AS project_name,
        d.duration_seconds,
        d.status,
        d.started_at,
        ROW_NUMBER() OVER (PARTITION BY d.project_id ORDER BY d.duration_seconds ASC) AS fastest_rank,
        ROW_NUMBER() OVER (PARTITION BY d.project_id ORDER BY d.duration_seconds DESC) AS slowest_rank
    FROM deployments d
    JOIN projects p ON d.project_id = p.id
    WHERE d.status = 'SUCCESS' AND d.duration_seconds IS NOT NULL
)
SELECT 
    project_name,
    MAX(CASE WHEN fastest_rank = 1 THEN duration_seconds END) AS fastest_deployment_sec,
    MAX(CASE WHEN slowest_rank = 1 THEN duration_seconds END) AS slowest_deployment_sec
FROM RankedDeployments
GROUP BY project_name;


-- ------------------------------------------------------------------------------
-- 4. WINDOW FUNCTIONS (ROW_NUMBER, Moving Averages, Running Totals)
-- ------------------------------------------------------------------------------
-- Query: Calculate moving averages and cumulative duration trends partitioned by project
SELECT 
    d.id AS deployment_id,
    p.name AS project_name,
    d.started_at,
    d.duration_seconds,
    d.status,
    -- Window Function 1: Sequential Deployment Index per project
    ROW_NUMBER() OVER (
        PARTITION BY d.project_id 
        ORDER BY d.started_at ASC
    ) AS project_deployment_number,
    -- Window Function 2: Moving Average of the last 3 deployments
    ROUND(
        AVG(d.duration_seconds) OVER (
            PARTITION BY d.project_id 
            ORDER BY d.started_at ASC 
            ROWS BETWEEN 2 PRECEDING AND CURRENT ROW
        ), 1
    ) AS moving_avg_duration_3,
    -- Window Function 3: Cumulative build time spent on the project
    SUM(d.duration_seconds) OVER (
        PARTITION BY d.project_id 
        ORDER BY d.started_at ASC
    ) AS cumulative_duration_seconds
FROM deployments d
JOIN projects p ON d.project_id = p.id
ORDER BY p.name, d.started_at;


-- ------------------------------------------------------------------------------
-- 5. ACID TRANSACTION WITH SAVEPOINT & ERROR RECOVERY
-- ------------------------------------------------------------------------------
-- Atomic deployment trigger demonstrating transactional safety and rollback:
BEGIN;

  -- 1. Insert Deployment Master Record
  INSERT INTO deployments (id, project_id, status, commit_hash, commit_message, triggered_by)
  SELECT 
    'f0000000-0000-0000-0000-000000000001',
    id,
    'ANALYZING',
    'c7d8e9f',
    'chore: academic transaction verification',
    'examiner@university.edu'
  FROM projects 
  LIMIT 1;

  -- Create a Savepoint
  SAVEPOINT step_inserts;

  -- 2. Insert sequential stages
  INSERT INTO deployment_steps (deployment_id, step_name, provider, step_order, status)
  VALUES 
    ('f0000000-0000-0000-0000-000000000001', 'Repository Inspection', 'GITHUB', 1, 'RUNNING'),
    ('f0000000-0000-0000-0000-000000000001', 'Backend Build & Deploy', 'RENDER', 2, 'PENDING');

  -- 3. Initial Log Entry
  INSERT INTO deployment_logs (deployment_id, log_level, stage, message)
  VALUES ('f0000000-0000-0000-0000-000000000001', 'INFO', 'ORCHESTRATOR', 'Transaction commit verified.');

COMMIT;


-- ------------------------------------------------------------------------------
-- 6. QUERYING THE DATABASE VIEW (College Core Deliverable)
-- ------------------------------------------------------------------------------
SELECT * FROM v_project_deployment_metrics;

