import { streamText, tool } from "ai";
import * as blink from "blink";
import { z } from "zod";
import { convertToModelMessages } from "ai";
import { getSchema, runQuery } from "./db.js";

export default blink.agent({
  displayName: "gh-project-agent",

  async sendMessages({ messages }) {
    return streamText({
      model: "openai/gpt-oss-120b",
      system: buildSystemPrompt(),
      messages: convertToModelMessages(messages),
      tools: {
        db_schema: tool({
          description:
            "Return the schema and usage notes for the Neon database backing GitHub Project insights. Includes tables, columns, indexes, and a concise guide for common queries using project_name.",
          inputSchema: z.object({}),
          execute: async () => {
            const schema = await getSchema();
            return schema;
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
            const result = await runQuery({
              sql,
              params,
              limit,
              offset,
              timeoutMs,
            });
            return result;
          },
        }),
      },
    });
  },
});
