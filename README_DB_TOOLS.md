Database tools for GitHub Project insights

Overview

- db_schema: returns schema metadata for the Neon Postgres database used by the agent, plus a concise usage guide.
- db_query: executes a read-only SELECT with enforced LIMIT/OFFSET and timeout.

Environment

- Set DATABASE_URL to your Neon connection string before starting the agent.
- Connections use SSL with rejectUnauthorized=false for Neon.

Defaults and safety

- Read-only transactions only; DDL/DML are blocked.
- Single-statement SELECT only (WITH … SELECT allowed).
- Default limit=200, offset=0; limit is capped at 2000.
- Default timeout=15000ms; capped at 60000ms.

Schema summary

- field*changes: append-only audit of field changes
  Columns: project_node_id, project_name, item_node_id, repository_name, field_name, field_type, old_value, new_value, changed_at, detected_at, actor_login, plus content*\* for context.
  Indexes: project_node_id, project_name, repository_name, item_node_id, changed_at
- current*field_values: latest snapshot of each item’s fields
  Columns: project_node_id, project_name, item_node_id, repository_name, field_name, field_type, field_value, updated_at, plus content*\*
  Primary key: (item_node_id, field_name)
  Indexes: project_node_id, project_name, repository_name

Query patterns

- What’s new/what changed (last 7 days default):
  select \* from field_changes
  where project_name = $1 and changed_at >= now() - interval '7 days'
  order by changed_at desc

- Current state:
  select \* from current_field_values
  where project_name = $1
