import { streamText, tool } from "ai";
import * as blink from "blink";
import { z } from "zod";
import { convertToModelMessages } from "ai";
import { getSchema, runQuery } from "./db.ts";
import { buildSystemPrompt } from "./prompt.ts";

export default blink.agent({
  async sendMessages({ messages }) {
    return streamText({
      //model: "openai/gpt-oss-120b",
      model: "anthropic/claude-sonnet-4",
      system: buildSystemPrompt(),
      messages: convertToModelMessages(messages),
      tools: {
        db_schema: tool({
          description:
            "Return the schema and usage notes for the Neon database backing GitHub Project insights. Includes tables, columns, indexes, and a concise guide for common queries using project_name.",
          inputSchema: z.object({}),
          execute: async () => {
            const started = Date.now();
            console.log("[tools] db_schema: start");
            try {
              const schema = await getSchema();
              const cols = Array.isArray((schema as any)?.columns)
                ? (schema as any).columns.length
                : "n/a";
              const idx = Array.isArray((schema as any)?.indexes)
                ? (schema as any).indexes.length
                : "n/a";
              console.log(
                `[tools] db_schema: success in ${Date.now() - started}ms (columns=${cols}, indexes=${idx})`,
              );
              return schema;
            } catch (err) {
              console.error(
                `[tools] db_schema: error after ${Date.now() - started}ms`,
                err,
              );
              throw err;
            }
          },
        }),
        db_query: tool({
          description:
            "Execute a read-only SQL SELECT against the Neon database. Use project_name for scoping; default lookback is the last 7 days for 'what's new' queries. Returns rows with enforced LIMIT/OFFSET (max 2000).",
          inputSchema: z.object({
            sql: z
              .string()
              .describe("A single SELECT (or WITH ... SELECT) statement."),
            params: z.array(z.any()).optional().default([]),
            limit: z.number().int().min(1).max(2000).optional().default(200),
            offset: z.number().int().min(0).optional().default(0),
            timeoutMs: z
              .number()
              .int()
              .min(1000)
              .max(60000)
              .optional()
              .default(15000),
          }),
          execute: async ({ sql, params, limit, offset, timeoutMs }) => {
            const started = Date.now();
            const sqlPreview = typeof sql === "string" ? sql.slice(0, 120) : "";
            console.log(
              `[tools] db_query: start (limit=${limit}, offset=${offset}, timeoutMs=${timeoutMs}, sqlPreview=${JSON.stringify(
                sqlPreview,
              )})`,
            );
            try {
              const result = await runQuery({
                sql,
                params,
                limit,
                offset,
                timeoutMs,
              });
              console.log(
                `[tools] db_query: success in ${Date.now() - started}ms (rows=${result?.rowCount}, limit=${result?.appliedLimit}, offset=${result?.appliedOffset})`,
              );
              return result;
            } catch (err) {
              console.error(
                `[tools] db_query: error after ${Date.now() - started}ms`,
                err,
              );
              throw err;
            }
          },
        }),
      },
    });
  },
});
