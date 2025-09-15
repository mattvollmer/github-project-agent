SET client_min_messages = warning;
SET TIME ZONE 'UTC';

DROP TABLE IF EXISTS field_changes CASCADE;
DROP TABLE IF EXISTS current_field_values CASCADE;

CREATE TABLE field_changes (
  id BIGSERIAL PRIMARY KEY,
  project_node_id TEXT,
  project_name TEXT,
  item_node_id TEXT NOT NULL,
  content_node_id TEXT,
  content_type TEXT,
  content_title TEXT,
  content_url TEXT,
  repository_name TEXT,
  field_name TEXT NOT NULL,
  field_type TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  changed_at TIMESTAMPTZ NOT NULL,
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  actor_login TEXT,
  UNIQUE (item_node_id, field_name, changed_at)
);

CREATE INDEX IF NOT EXISTS idx_fc_project_node_id ON field_changes (project_node_id);
CREATE INDEX IF NOT EXISTS idx_fc_project_name ON field_changes (project_name);
CREATE INDEX IF NOT EXISTS idx_fc_repository_name ON field_changes (repository_name);
CREATE INDEX IF NOT EXISTS idx_fc_item_node_id ON field_changes (item_node_id);
CREATE INDEX IF NOT EXISTS idx_fc_changed_at ON field_changes (changed_at);

CREATE TABLE current_field_values (
  project_node_id TEXT,
  project_name TEXT,
  item_node_id TEXT NOT NULL,
  content_node_id TEXT,
  content_type TEXT,
  content_title TEXT,
  content_url TEXT,
  repository_name TEXT,
  field_name TEXT NOT NULL,
  field_type TEXT NOT NULL,
  field_value JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (item_node_id, field_name)
);

CREATE INDEX IF NOT EXISTS idx_cfv_project_node_id ON current_field_values (project_node_id);
CREATE INDEX IF NOT EXISTS idx_cfv_project_name ON current_field_values (project_name);
CREATE INDEX IF NOT EXISTS idx_cfv_repository_name ON current_field_values (repository_name);
