import { describe, it, expect } from "vitest";
import { runQuery } from "../db.ts";

const A_START = "2025-01-10T00:00:00Z";
const A_END = "2025-01-12T23:59:59Z";

const HAS_DB = !!process.env.DATABASE_URL;
const itIf = HAS_DB ? it : it.skip;

// These tests assert the seeded dataset structure and basic semantics.
describe("scenario: seeded Neon branch", () => {
  itIf("has 4 field_changes for Proj A in the fixed window", async () => {
    const res = await runQuery({
      sql: `select * from field_changes where project_name = $1 and changed_at between $2 and $3 order by changed_at asc`,
      params: ["Proj A", A_START, A_END],
      limit: 100,
    });
    expect(res.rowCount).toBe(4);
  });

  itIf("Status for ITEM_A_1 is Done in current_field_values", async () => {
    const res = await runQuery({
      sql: `select field_value from current_field_values where project_name = $1 and item_node_id = $2 and field_name = 'Status'`,
      params: ["Proj A", "ITEM_A_1"],
      limit: 10,
    });
    expect(res.rowCount).toBe(1);
    const value = res.rows[0].field_value;
    expect(value).toBe("Done");
  });

  itIf("deletion event exists with correct old/new values", async () => {
    const res = await runQuery({
      sql: `select old_value, new_value from field_changes where project_name = $1 and field_name = '_item_deleted'`,
      params: ["Proj A"],
      limit: 10,
    });
    expect(res.rowCount).toBe(1);
    const row = res.rows[0];
    expect(row.old_value).toBe(true);
    expect(row.new_value).toBeNull();
  });
});
