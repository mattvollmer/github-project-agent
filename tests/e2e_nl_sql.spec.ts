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

async function nlToSql(prompt: string): Promise<string> {
  const system =
    buildSystemPrompt() +
    "\n\nAdditional instructions:" +
    "\n- Only respond with a single SQL statement." +
    "\n- Output the SQL inside a fenced code block marked 'sql'." +
    "\n- Do not include explanations.";

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
  const match =
    content.match(/```sql\s*([\s\S]*?)```/i) ||
    content.match(/```\s*([\s\S]*?)```/i);
  const sql = (match ? match[1] : content).trim();
  if (!/^\s*with\s+|^\s*select\s+/i.test(sql)) {
    throw new Error(`not_select_sql: ${sql.slice(0, 160)}`);
  }
  return sql;
}

// Increase per-test timeout for E2E calls
const T = 30000;

const A_START = "2025-01-10T00:00:00Z";
const A_END = "2025-01-12T23:59:59Z";

// E2E 1: count field changes in window
itE2E(
  "e2e: Proj A field_changes in fixed window = 4",
  async () => {
    const sql = await nlToSql(
      `For project "Proj A", how many field changes occurred between ${A_START} and ${A_END}? Return a single row with a numeric count.`,
    );
    const res = await runQuery({ sql, limit: 2000 });
    // Accept either a count(*) row or selecting rows and we count here
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
    const sql = await nlToSql(
      `In project "Proj A", what is the current Status of item with node id ITEM_A_1? Return a single row with the status value.`,
    );
    const res = await runQuery({ sql, limit: 50 });
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
    const sql = await nlToSql(
      `List deletion events for project "Proj A" using the field_changes table. Return the old and new values.`,
    );
    const res = await runQuery({ sql, limit: 50 });
    expect(res.rowCount).toBeGreaterThanOrEqual(1);
    // Must contain a row where old_value=true and new_value is null
    const ok = res.rows.some(
      (r) =>
        r?.old_value === true &&
        (r?.new_value === null || r?.new_value === undefined),
    );
    expect(ok).toBe(true);
  },
  T,
);
