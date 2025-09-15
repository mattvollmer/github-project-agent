import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Ensure env var is present so db.ts doesn't throw before mocks
beforeEach(() => {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ||
    "postgres://user:pass@localhost/db?sslmode=require";
});

// Mock pg Pool to avoid real connections and capture queries
const queryCalls: Array<{ text?: string; values?: unknown[] } | string> = [];
const fakeClient = {
  async query(arg: any) {
    queryCalls.push(arg);
    if (typeof arg === "string") return { rows: [], rowCount: 0 } as any;
    return { rows: [{ dummy: 1 }], rowCount: 1 } as any;
  },
  release() {},
};

vi.mock("pg", () => {
  class Pool {
    constructor(_: any) {}
    async connect() {
      return fakeClient as any;
    }
  }
  return { Pool };
});

import { runQuery, getSchema } from "../db.ts";
import { buildSystemPrompt } from "../prompt.ts";

describe("contract: system prompt guidance", () => {
  it("mentions tool names, safety, and 7-day default lookback", () => {
    const s = buildSystemPrompt();
    expect(s).toContain("Tools available: db_schema, db_query");
    expect(s).toContain("Only generate SELECT (or WITH ... SELECT)");
    expect(s).toContain("Keep LIMIT <= 2000");
    expect(s).toMatch(/Default lookback window.*last 7 days/i);
    expect(s).toMatch(
      /field_changes\.changed_at is the authoritative timestamp/i,
    );
  });
});

describe("contract: runQuery safety and limit/offset enforcement", () => {
  beforeEach(() => {
    queryCalls.length = 0;
  });

  it("wraps arbitrary SELECT and enforces limit/offset", async () => {
    const res = await runQuery({
      sql: "select 1 as x",
      limit: 5000,
      offset: -10,
    });
    expect(res.rowCount).toBe(1);
    // The last structured call should be the wrapped SELECT
    const last = queryCalls.find((c) => typeof c !== "string") as any;
    expect(last.text).toMatch(
      /select \* from \(\s*select 1 as x\s*\) as t limit \$(\d+) offset \$(\d+)/i,
    );
    // Clamped
    expect(last.values?.[0]).toBe(2000);
    expect(last.values?.[1]).toBe(0);
  });

  it("rejects non-SELECT statements", async () => {
    await expect(runQuery({ sql: "insert into t values (1)" })).rejects.toThrow(
      /Only SELECT queries are allowed|forbidden/i,
    );
  });

  it("rejects multiple statements", async () => {
    await expect(runQuery({ sql: "select 1; select 2" })).rejects.toThrow(
      /Only a single SELECT statement/i,
    );
  });
});

describe("contract: getSchema summary includes expected tables", () => {
  it("returns summary text mentioning field_changes and current_field_values", async () => {
    // getSchema will call the mocked client; our fake returns empty rows but we assert summary text only
    const s = await getSchema();
    expect(s.summary).toMatch(/field_changes/);
    expect(s.summary).toMatch(/current_field_values/);
  });
});
