-- Add Render plan and backend listen configuration to project_services
ALTER TABLE project_services ADD COLUMN IF NOT EXISTS render_plan VARCHAR(50) NOT NULL DEFAULT 'free';
ALTER TABLE project_services ADD COLUMN IF NOT EXISTS listens_on_port_env BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE project_services ADD COLUMN IF NOT EXISTS listens_on_all_interfaces BOOLEAN NOT NULL DEFAULT false;
