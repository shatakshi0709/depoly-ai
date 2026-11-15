-- Additive, non-destructive migration for Phases 2-4
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Deployment attempt/retry tracking and provider IDs
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS attempt_number INTEGER NOT NULL DEFAULT 1;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS retried_from_id UUID NULL;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS render_service_id VARCHAR(255);
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS render_deploy_id VARCHAR(255);
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS vercel_project_id VARCHAR(255);
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS vercel_deploy_id VARCHAR(255);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'deployments_retried_from_id_fkey'
  ) THEN
    ALTER TABLE deployments
      ADD CONSTRAINT deployments_retried_from_id_fkey
      FOREIGN KEY (retried_from_id) REFERENCES deployments(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_deployments_retried_from_id ON deployments(retried_from_id);
CREATE INDEX IF NOT EXISTS idx_deployments_started_at ON deployments(started_at DESC);

-- Log source distinction (ORCHESTRATOR vs PROVIDER)
ALTER TABLE deployment_logs ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'ORCHESTRATOR';

-- User-specific notifications
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  deployment_id UUID NULL REFERENCES deployments(id) ON DELETE SET NULL,
  project_id UUID NULL REFERENCES projects(id) ON DELETE SET NULL,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_deployment_id ON notifications(deployment_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
