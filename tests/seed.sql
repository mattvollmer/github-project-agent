SET TIME ZONE 'UTC';
BEGIN;

-- Canonical timestamps (fixed, distant)
-- 2025-01-10T08:00:00Z, 2025-01-11T09:00:00Z, 2025-01-12T10:00:00Z
-- Projects: Proj A, Proj B
-- Items use readable IDs to simplify assertions
-- Repos: owner/repo1, owner/repo2

-- Proj A, ITEM_A_1: Status changed In Progress -> Done
INSERT INTO field_changes (
  project_node_id, project_name, item_node_id, repository_name,
  field_name, field_type, old_value, new_value, changed_at, detected_at, actor_login,
  content_type, content_title, content_url
) VALUES
  (NULL, 'Proj A', 'ITEM_A_1', 'owner/repo1',
   'Status', 'ProjectV2ItemFieldSingleSelectValue',
   '"In Progress"'::jsonb, '"Done"'::jsonb,
   '2025-01-11T09:00:00Z', '2025-01-11T09:00:00Z', 'alice',
   'Issue', 'Improve logging', 'https://github.com/owner/repo1/issues/101');

-- Proj A, ITEM_A_1: Labels changed
INSERT INTO field_changes (
  project_node_id, project_name, item_node_id, repository_name,
  field_name, field_type, old_value, new_value, changed_at, detected_at, actor_login
) VALUES
  (NULL, 'Proj A', 'ITEM_A_1', 'owner/repo1',
   'labels', 'issue_labels',
   '["bug"]'::jsonb, '["bug","backend"]'::jsonb,
   '2025-01-12T10:00:00Z', '2025-01-12T10:00:00Z', 'bob');

-- Proj A, ITEM_A_2: Assignees added
INSERT INTO field_changes (
  project_node_id, project_name, item_node_id, repository_name,
  field_name, field_type, old_value, new_value, changed_at, detected_at, actor_login
) VALUES
  (NULL, 'Proj A', 'ITEM_A_2', 'owner/repo1',
   'assignees', 'issue_assignees',
   '[]'::jsonb, '["carol"]'::jsonb,
   '2025-01-10T08:00:00Z', '2025-01-10T08:00:00Z', 'alice');

-- Proj A, ITEM_A_3: Item deletion event
INSERT INTO field_changes (
  project_node_id, project_name, item_node_id, repository_name,
  field_name, field_type, old_value, new_value, changed_at, detected_at, actor_login
) VALUES
  (NULL, 'Proj A', 'ITEM_A_3', 'owner/repo2',
   '_item_deleted', 'system_event',
   'true'::jsonb, 'null'::jsonb,
   '2025-01-12T10:00:00Z', '2025-01-12T10:00:00Z', 'system');

-- Proj B, ITEM_B_1: Status changed Backlog -> In Progress
INSERT INTO field_changes (
  project_node_id, project_name, item_node_id, repository_name,
  field_name, field_type, old_value, new_value, changed_at, detected_at, actor_login
) VALUES
  (NULL, 'Proj B', 'ITEM_B_1', 'owner/repo2',
   'Status', 'ProjectV2ItemFieldSingleSelectValue',
   '"Backlog"'::jsonb, '"In Progress"'::jsonb,
   '2025-01-11T09:00:00Z', '2025-01-11T09:00:00Z', 'dana');

-- Snapshot rows consistent with the changes above

-- ITEM_A_1 final state
INSERT INTO current_field_values (
  project_node_id, project_name, item_node_id, repository_name,
  field_name, field_type, field_value, updated_at, content_type, content_title, content_url
) VALUES
  (NULL, 'Proj A', 'ITEM_A_1', 'owner/repo1',
   'Status', 'ProjectV2ItemFieldSingleSelectValue', '"Done"'::jsonb, '2025-01-12T10:00:00Z',
   'Issue', 'Improve logging', 'https://github.com/owner/repo1/issues/101'),
  (NULL, 'Proj A', 'ITEM_A_1', 'owner/repo1',
   'labels', 'issue_labels', '["bug","backend"]'::jsonb, '2025-01-12T10:00:00Z',
   'Issue', 'Improve logging', 'https://github.com/owner/repo1/issues/101');

-- ITEM_A_2 final state
INSERT INTO current_field_values (
  project_node_id, project_name, item_node_id, repository_name,
  field_name, field_type, field_value, updated_at
) VALUES
  (NULL, 'Proj A', 'ITEM_A_2', 'owner/repo1',
   'assignees', 'issue_assignees', '["carol"]'::jsonb, '2025-01-10T08:00:00Z');

-- ITEM_A_3 final state (deleted item implies no snapshot rows)

-- ITEM_B_1 final state
INSERT INTO current_field_values (
  project_node_id, project_name, item_node_id, repository_name,
  field_name, field_type, field_value, updated_at
) VALUES
  (NULL, 'Proj B', 'ITEM_B_1', 'owner/repo2',
   'Status', 'ProjectV2ItemFieldSingleSelectValue', '"In Progress"'::jsonb, '2025-01-11T09:00:00Z');

COMMIT;
