import { it, expect } from "vitest";
import { runQuery } from "../db.ts";
import { buildSystemPrompt } from "../prompt.ts";

const GATEWAY_KEY = process.env.AI_GATEWAY_API_KEY;
const GATEWAY_BASE = process.env.AI_GATEWAY_BASE_URL;
const GATEWAY_MODEL = process.env.AI_GATEWAY_MODEL;

const HAS_E2E =
  !!process.env.DATABASE_URL &&
  !!GATEWAY_KEY &&
  !!GATEWAY_BASE &&
  !!GATEWAY_MODEL;
const itE2E = HAS_E2E ? it : it.skip;

async function nlToSql(
  prompt: string,
): Promise<{ sql: string; params: unknown[] }> {
  const system =
    buildSystemPrompt() +
    "\n\nAdditional instructions:" +
    "\n- Only respond with a single SQL statement." +
    "\n- Output the SQL inside a fenced code block marked 'sql'." +
    "\n- Do not include explanations." +
    "\n- Do NOT use parameter placeholders like $1, $2. Inline literal values (with proper quoting) directly in the SQL.";

  const res = await fetch(`${GATEWAY_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${GATEWAY_KEY}`,
    },
    body: JSON.stringify({
      model: GATEWAY_MODEL,
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`gateway_error: ${res.status} ${res.statusText} ${text}`);
  }

  const data = (await res.json()) as any;
  const content = data?.choices?.[0]?.message?.content ?? "";
  const sqlMatch = content.match(/```sql\s*([\s\S]*?)```/i);
  const jsonMatch = content.match(/```json\s*([\s\S]*?)```/i);
  if (!sqlMatch) throw new Error("no_sql_block_found");
  const sql = sqlMatch[1].trim();
  let params: unknown[] = [];
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      params = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as any)?.params)
          ? (parsed as any).params
          : [];
    } catch {
      params = [];
    }
  }
  if (!/^\s*with\s+|^\s*select\s+/i.test(sql)) {
    throw new Error(`not_select_sql: ${sql.slice(0, 160)}`);
  }
  const maxPlaceholder = (() => {
    const m = [...sql.matchAll(/\$(\d+)/g)];
    return m.length ? Math.max(...m.map((x) => Number(x[1]) || 0)) : 0;
  })();
  if (maxPlaceholder > 0 && params.length < maxPlaceholder) {
    // allow caller to inject fallback params per test
  }
  return { sql, params };
}

// Increase per-test timeout for E2E calls
const T = 60000; // Increase test timeout to 60000 ms

const A_START = "2025-01-10T00:00:00Z";
const A_END = "2025-01-12T23:59:59Z";

// E2E 1: count field changes in window
itE2E(
  "e2e: Proj A field_changes in fixed window = 4",
  async () => {
    const { sql, params } = await nlToSql(
      `MUST use table field_changes. MUST filter project_name = 'Proj A'. MUST restrict changed_at between '${A_START}' and '${A_END}'. For project \"Proj A\", how many field changes occurred between ${A_START} and ${A_END}? Return a single row with a numeric count.`,
    );
    let p = params;
    if ((!p || p.length === 0) && /\\$\\d+/.test(sql)) {
      p = ["Proj A", A_START, A_END];
    }
    // Debugging: log the SQL query and params
    console.log(`Running SQL: ${sql}`, params);
    const res = await runQuery({
      sql,
      params: p,
      limit: 2000,
      timeoutMs: 60000,
    }); // Increased timeoutMs for runQuery
    const count = (() => {
      const row = res.rows?.[0] ?? {};
      const byKey = Object.values(row).find((v) => typeof v === "number");
      return typeof byKey === "number" ? byKey : res.rowCount;
    })();
    expect(count).toBe(4);
  },
  T,
);

// E2E 2: current status for ITEM_A_1
itE2E(
  "e2e: Proj A ITEM_A_1 Status is Done",
  async () => {
    const { sql, params } = await nlToSql(
      `MUST use table current_field_values. MUST filter project_name = 'Proj A' AND item_node_id = 'ITEM_A_1' AND field_name = 'Status'. Return a single row with only the status value.`,
    );
    let p = params;
    if ((!p || p.length === 0) && /\\$\\d+/.test(sql)) {
      p = ["Proj A", "ITEM_A_1"];
    }
    console.log(`Running SQL: ${sql}`, p);
    const res = await runQuery({
      sql,
      params: p,
      limit: 50,
      timeoutMs: 120000,
    }); // timeout increased to 120000 ms
    console.log(`Query result:`, res); // additional debug
    const textVal = (() => {
      const row = res.rows?.[0] ?? {};
      const str = Object.values(row).find((v) => typeof v === "string") as
        | string
        | undefined;
      return str;
    })();
    expect(textVal).toBe("Done");
  },
  T,
);

// E2E 3: deletion events list
itE2E(
  "e2e: Proj A has one deletion event",
  async () => {
    const { sql, params } = await nlToSql(
      `MUST use table field_changes. MUST filter project_name = 'Proj A' AND field_name = '_item_deleted'. Return old_value and new_value columns only.`,
    );
    let p = params;
    if ((!p || p.length === 0) && /\\$\\d+/.test(sql)) {
      p = ["Proj A"];
    }
    console.log(`Running SQL: ${sql}`, p);
    const res = await runQuery({
      sql,
      params: p,
      limit: 50,
      timeoutMs: 120000,
    }); // timeout increased to 120000 ms
    console.debug(`Deletion check result:`, res); // additional debug
    expect(res.rowCount).toBeGreaterThanOrEqual(1);
    const ok = res.rows.some(
      (r) =>
        r?.old_value === true &&
        (r?.new_value === null || r?.new_value === undefined),
    );
    expect(ok).toBe(true);
  },
  T,
);
