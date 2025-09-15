import { App, LogLevel } from "@slack/bolt";
import { z } from "zod";
import { streamText, tool } from "ai";
import { buildSystemPrompt } from "./prompt.js";
import { getSchema, runQuery } from "./db.js";

const appToken = process.env.SLACK_APP_TOKEN; // xapp-*** (Socket Mode)
const botToken = process.env.SLACK_BOT_TOKEN; // xoxb-***

if (!appToken || !botToken) {
  console.warn(
    "SLACK_APP_TOKEN and SLACK_BOT_TOKEN are required to run Slack Socket Mode.",
  );
}

const app = new App({
  socketMode: true,
  appToken,
  token: botToken,
  logLevel: LogLevel.INFO,
});

const REACTION = "face_with_monocle"; // 🧐

function stripMonocle(input: string): string {
  return (input || "")
    .replace(/:face_with_monocle:|:monocle_face:/g, "")
    .replace(/\u{1F9D0}\uFE0F?/gu, "")
    .replace(/^\s+/, "")
    .trim();
}

async function runAgentSession(args: {
  userText: string;
  channel: string;
  thread_ts: string;
  client: any;
}) {
  const { userText, channel, thread_ts, client } = args;
  if (!userText || userText.trim().length === 0) {
    await client.chat.postMessage({
      channel,
      thread_ts,
      text: "Ask me about your GitHub Projects. For example:\n- what's new in the last 7 days for Project X?\n- list items in Project X with Status = In Progress\n- show all changes for repo owner/repo in Project X",
    });
    return;
  }
  let postedByTool = false;
  let invokedDbQuery = false;
  const lc = userText.toLowerCase();
  const requireChanged = /what\s+changed|changed\s+(today|recent|this\s+week|last\s+\d+\s+days)/i.test(lc);
  let changedQueryOk = false;
  let postedAfterQuery = false;

  const result = await streamText({
    model: "anthropic/claude-sonnet-4",
    system:
      buildSystemPrompt() +
      "\n\nSlack behavior:\n- You MAY post brief clarifications or disambiguation via slack_send before any database calls.\n- Once you call db_query, you MUST produce exactly one final results message via slack_send in this run.\n- For results, do not write preambles like \"I'll help you\" — post the answer concisely.\n- If database results are needed, call db_schema/db_query first, then slack_send with the answer.\n- Format for Slack mrkdwn.\n- Do not include monocle emoji in the message text.",
    temperature: 0,
    toolChoice: "auto" as const,
    messages: [{ role: "user", content: userText }],
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
          invokedDbQuery = true;
          const s = (sql || "").toLowerCase();
          if (requireChanged) {
            if (s.includes("from field_changes") && s.includes("changed_at") && s.includes("project_name")) {
              changedQueryOk = true;
            }
          }
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
      slack_send: tool({
        description:
          "Send a Slack message in the current thread. Use mrkdwn formatting.",
        inputSchema: z.object({
          text: z.string().min(1),
        }),
        execute: async ({ text }) => {
          // Before any DB calls, allow free clarifications.
          if (invokedDbQuery) {
            // After db_query, allow exactly one final message, and require correct query for 'what changed'.
            if (postedAfterQuery) {
              throw new Error("You have already posted the final message for this run.");
            }
            if (requireChanged && !changedQueryOk) {
              throw new Error(
                "For 'what changed', you MUST query field_changes with changed_at and project_name filters before the final message."
              );
            }
          }
          const clean = stripMonocle(text);
          await client.chat.postMessage({
            channel,
            thread_ts,
            text: clean,
          });
          postedByTool = true;
          if (invokedDbQuery) postedAfterQuery = true;
          return { ok: true };
        },
      }),
    },
  });

  if (!postedByTool) {
    const strict = await streamText({
      model: "anthropic/claude-sonnet-4",
      system:
        buildSystemPrompt() +
        "\n\nSlack behavior (strict):\n- You MAY post brief clarifications via slack_send before any DB call.\n- Once you call db_query, you MUST post exactly one final results message via slack_send and stop.\n- Do NOT output any text except via slack_send.",
      temperature: 0,
      toolChoice: "auto" as const,
      messages: [{ role: "user", content: userText }],
      tools: {
        db_schema: tool({ inputSchema: z.object({}), execute: async () => getSchema() }),
        db_query: tool({
          inputSchema: z.object({
            sql: z.string(),
            params: z.array(z.any()).optional().default([]),
            limit: z.number().int().min(1).max(2000).optional().default(200),
            offset: z.number().int().min(0).optional().default(0),
            timeoutMs: z.number().int().min(1000).max(60000).optional().default(15000),
          }),
          execute: async ({ sql, params, limit, offset, timeoutMs }) => {
            invokedDbQuery = true;
            const s = (sql || "").toLowerCase();
            if (requireChanged) {
              if (s.includes("from field_changes") && s.includes("changed_at") && s.includes("project_name")) {
                changedQueryOk = true;
              }
            }
            return runQuery({ sql, params, limit, offset, timeoutMs });
          },
        }),
        slack_send: tool({
          inputSchema: z.object({ text: z.string().min(1) }),
          execute: async ({ text }) => {
            if (invokedDbQuery) {
              if (postedAfterQuery) {
                throw new Error("You have already posted the final message for this run.");
              }
              if (requireChanged && !changedQueryOk) {
                throw new Error(
                  "For 'what changed', you MUST query field_changes with changed_at and project_name filters before the final message."
                );
              }
            }
            const clean = stripMonocle(text);
            await client.chat.postMessage({ channel, thread_ts, text: clean });
            postedByTool = true;
            if (invokedDbQuery) postedAfterQuery = true;
            return { ok: true };
          },
        }),
      },
    });
    await strict.text;
  }
}

function cleanMention(text: string, botUserId?: string): string {
  let t = text || "";
  if (botUserId) {
    const mention = new RegExp(`<@${botUserId}>`, "g");
    t = t.replace(mention, "").trim();
  }
  return t;
}

app.event("app_mention", async ({ event, client, logger, context }) => {
  const botUserId = context.botUserId as string | undefined;
  const userText = cleanMention((event as any).text || "", botUserId);
  const channel = event.channel as string;
  const ts = (event as any).ts as string;
  const thread_ts = ((event as any).thread_ts as string) || ts;

  try {
    try {
      await client.reactions.add({ channel, name: REACTION, timestamp: ts });
    } catch (err) {
      logger.warn({ err }, "failed_to_add_reaction");
    }

    await runAgentSession({ userText, channel, thread_ts, client });
  } catch (err) {
    logger.error(err);
  } finally {
    try {
      await client.reactions.remove({ channel, name: REACTION, timestamp: ts });
    } catch (err) {
      logger.warn({ err }, "failed_to_remove_reaction");
    }
  }
});

app.event("message", async ({ event, client, logger }) => {
  const e: any = event;
  if (e.channel_type !== "im" || e.subtype) return;
  const channel = e.channel as string;
  const ts = e.ts as string;
  const thread_ts = (e.thread_ts as string) || ts;

  try {
    try {
      await client.reactions.add({ channel, name: REACTION, timestamp: ts });
    } catch (err) {
      logger.warn({ err }, "failed_to_add_reaction");
    }

    await runAgentSession({ userText: e.text || "", channel, thread_ts, client });
  } catch (err) {
    logger.error(err);
  } finally {
    try {
      await client.reactions.remove({ channel, name: REACTION, timestamp: ts });
    } catch (err) {
      logger.warn({ err }, "failed_to_remove_reaction");
    }
  }
});

export async function startSlack() {
  await app.start();
  console.log("Slack app (ProjectBot) running in Socket Mode");
}

if (import.meta.main) {
  startSlack().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}