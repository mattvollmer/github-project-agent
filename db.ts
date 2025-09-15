import { Pool } from "pg";

let pool: Pool | null = null;

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL is required. Set it to your Neon connection string before starting the agent.",
      );
    }
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return pool;
}

export type Column = {
  table: string;
  name: string;
  dataType: string;
  isNullable: boolean;
};

export type Index = {
  table: string;
  name: string;
  definition: string;
};

export type SchemaInfo = {
  columns: Column[];
  indexes: Index[];
  summary: string;
};

const KNOWN_SCHEMA_SUMMARY = `
Tables:

1) field_changes (append-only)
  - id BIGSERIAL PRIMARY KEY
  - project_node_id TEXT NOT NULL
  - project_name TEXT
  - item_node_id TEXT NOT NULL
  - content_node_id TEXT
  - content_type TEXT
  - content_title TEXT
  - content_url TEXT
  - repository_name TEXT
  - field_name TEXT NOT NULL
  - field_type TEXT NOT NULL
  - old_value JSONB
  - new_value JSONB
  - changed_at TIMESTAMPTZ NOT NULL
  - detected_at TIMESTAMPTZ DEFAULT NOW()
  - actor_login TEXT
  - UNIQUE(item_node_id, field_name, changed_at)
  Indexes: project_node_id, project_name, repository_name, item_node_id, changed_at

2) current_field_values (current snapshot)
  - project_node_id TEXT NOT NULL
  - project_name TEXT
  - item_node_id TEXT NOT NULL
  - content_node_id TEXT
  - content_type TEXT
  - content_title TEXT
  - content_url TEXT
  - repository_name TEXT
  - field_name TEXT NOT NULL
  - field_type TEXT NOT NULL
  - field_value JSONB
  - updated_at TIMESTAMPTZ DEFAULT NOW()
  - PRIMARY KEY (item_node_id, field_name)
  Indexes: project_node_id, project_name, repository_name

Usage patterns:
- "What's new / what changed" → query field_changes filtered by project_name (or project_node_id) with changed_at >= now() - interval '7 days'.
- "Current state" → query current_field_values filtered by project_name (or project_node_id).
- Common filters: repository_name, field_name (e.g. Status), actor_login, content_type.
`;

export async function getSchema(): Promise<SchemaInfo> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN READ ONLY");

    const colRes = await client.query(
      `select c.table_name as table, c.column_name as name, c.data_type as "dataType", (c.is_nullable = 'YES') as "isNullable"
       from information_schema.columns c
       where c.table_schema = 'public' and c.table_name in ('field_changes','current_field_values')
       order by c.table_name, c.ordinal_position`,
    );

    const idxRes = await client.query(
      `select tablename as table, indexname as name, indexdef as definition
       from pg_indexes
       where schemaname = 'public' and tablename in ('field_changes','current_field_values')
       order by tablename, indexname`,
    );

    await client.query("COMMIT");

    const columns = colRes.rows as Column[];
    const indexes = idxRes.rows as Index[];

    return {
      columns,
      indexes,
      summary: KNOWN_SCHEMA_SUMMARY,
    };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw e;
  } finally {
    client.release();
  }
}

function ensureSelectOnly(sql: string) {
  const s = sql.trim();
  // Disallow multiple statements
  if (s.split(";").filter(Boolean).length > 1) {
    throw new Error("Only a single SELECT statement is allowed.");
  }
  // Remove trailing semicolon
  const noSemi = s.endsWith(";") ? s.slice(0, -1) : s;
  const head = noSemi.trim().slice(0, 20).toLowerCase();
  if (!(head.startsWith("select") || head.startsWith("with"))) {
    throw new Error("Only SELECT queries are allowed.");
  }
  // Block write/ddl keywords
  const forbidden =
    /(insert|update|delete|alter|drop|create|truncate|grant|revoke|vacuum|analyze|reindex)\b/i;
  if (forbidden.test(noSemi)) {
    throw new Error(
      "Query contains forbidden keywords. Read-only SELECTs only.",
    );
  }
  return noSemi;
}

export type QueryInput = {
  sql: string;
  params?: unknown[];
  limit?: number; // default 200, max 2000
  offset?: number; // default 0
  timeoutMs?: number; // default 15000
};

export async function runQuery({
  sql,
  params = [],
  limit = 200,
  offset = 0,
  timeoutMs = 15000,
}: QueryInput) {
  const safeSql = ensureSelectOnly(sql);
  const client = await getPool().connect();
  const clampedLimit = Math.max(0, Math.min(limit ?? 200, 2000));
  const clampedOffset = Math.max(0, offset ?? 0);

  try {
    await client.query("BEGIN READ ONLY");
    await client.query(
      `SET LOCAL statement_timeout TO '${Math.max(1000, Math.min(timeoutMs, 60000))}ms'`,
    );

    // Determine the highest positional parameter index used in the input SQL (e.g., $1, $2, ...)
    const matches = [...safeSql.matchAll(/\$(\d+)/g)];
    const maxInSql = matches.length
      ? Math.max(...matches.map((m) => Number(m[1]) || 0))
      : 0;
    const base = Math.max(maxInSql, Array.isArray(params) ? params.length : 0);
    const limitIdx = base + 1;
    const offsetIdx = base + 2;

    // Wrap the query to enforce limit/offset without trying to parse the SQL
    const wrapped = `select * from ( ${safeSql} ) as t limit $${limitIdx} offset $${offsetIdx}`;
    const res = await client.query({
      text: wrapped,
      values: [...params, clampedLimit, clampedOffset],
    });

    await client.query("COMMIT");

    return {
      rowCount: res.rowCount,
      rows: res.rows,
      appliedLimit: clampedLimit,
      appliedOffset: clampedOffset,
    };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw e;
  } finally {
    client.release();
  }
}
