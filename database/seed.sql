-- ==============================================================================
-- deplo.ai — Seed Data for Local Testing & Evaluation
-- ==============================================================================

-- 1. Insert Test User
INSERT INTO users (id, email, password_hash, full_name, avatar_url)
VALUES (
    'a0000000-0000-0000-0000-000000000001',
    'developer@deplo.ai',
    '$2b$10$wN3q.tHwJ3f6bE5B8Ue9yO5pYkXm7uEaL9L6aQ1cO5hQzXjN8m4Ke', -- bcrypt 'password123'
    'Lead Developer',
    'https://avatars.githubusercontent.com/u/9919?s=200&v=4'
) ON CONFLICT (email) DO NOTHING;

-- 2. Insert Test Project
INSERT INTO projects (id, user_id, name, github_repo_full_name, github_repo_url, default_branch, detected_preset)
VALUES (
    'b0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    'e-commerce-portal',
    'demo-org/e-commerce-portal',
    'https://github.com/demo-org/e-commerce-portal',
    'main',
    'REACT_VITE'
) ON CONFLICT DO NOTHING;

-- 3. Insert Backend Service (Render)
INSERT INTO project_services (id, project_id, service_type, provider, root_directory, build_command, start_command, health_check_path)
VALUES (
    'c0000000-0000-0000-0000-000000000001',
    'b0000000-0000-0000-0000-000000000001',
    'BACKEND',
    'RENDER',
    '/server',
    'npm install',
    'npm start',
    '/api/health'
) ON CONFLICT DO NOTHING;

-- 4. Insert Frontend Service (Vercel)
INSERT INTO project_services (id, project_id, service_type, provider, root_directory, build_command, start_command)
VALUES (
    'c0000000-0000-0000-0000-000000000002',
    'b0000000-0000-0000-0000-000000000001',
    'FRONTEND',
    'VERCEL',
    '/client',
    'npm run build',
    'npm run preview'
) ON CONFLICT DO NOTHING;

-- 5. Insert Sample Successful Deployment
INSERT INTO deployments (id, project_id, status, commit_hash, commit_message, triggered_by, backend_url, frontend_url, duration_seconds, started_at, completed_at)
VALUES (
    'd0000000-0000-0000-0000-000000000001',
    'b0000000-0000-0000-0000-000000000001',
    'SUCCESS',
    '8f4a12c',
    'feat: initial production launch',
    'MANUAL',
    'https://api-ecommerce.onrender.com',
    'https://ecommerce-store.vercel.app',
    145,
    NOW() - INTERVAL '2 hours',
    NOW() - INTERVAL '2 hours' + INTERVAL '145 seconds'
) ON CONFLICT DO NOTHING;

