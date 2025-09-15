import { App, LogLevel } from "@slack/bolt";
import { z } from "zod";
import { generateText, tool } from "ai";
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

async function runAgentOnce(userText: string): Promise<string> {
  const res = await generateText({
    model: "anthropic/claude-sonnet-4",
    system: buildSystemPrompt(),
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
  const text = res.text || "_No response._";
  return `🧐 ${text}`;
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
  try {
    const botUserId = context.botUserId as string | undefined;
    const userText = cleanMention((event as any).text || "", botUserId);
    const channel = event.channel;
    const ts = (event as any).ts;
    try {
      await client.reactions.add({ channel, name: REACTION, timestamp: ts });
    } catch (err) {
      logger.warn({ err }, "failed_to_add_reaction");
    }
    const answer = await runAgentOnce(userText);
    await client.chat.postMessage({
      channel: event.channel,
      text: answer,
      mrkdwn: true as any,
      thread_ts: (event as any).thread_ts || (event as any).ts,
    });
    try {
      await client.reactions.remove({ channel, name: REACTION, timestamp: ts });
    } catch (err) {
      logger.warn({ err }, "failed_to_remove_reaction");
    }
  } catch (err) {
    logger.error(err);
  }
});

app.event("message", async ({ event, client, logger }) => {
  try {
    const e: any = event;
    if (e.channel_type !== "im" || e.subtype) return;
    const channel = e.channel;
    const ts = e.ts;
    try {
      await client.reactions.add({ channel, name: REACTION, timestamp: ts });
    } catch (err) {
      logger.warn({ err }, "failed_to_add_reaction");
    }
    const answer = await runAgentOnce(e.text || "");
    await client.chat.postMessage({
      channel: e.channel,
      text: answer,
      mrkdwn: true as any,
      thread_ts: e.thread_ts || e.ts,
    });
    try {
      await client.reactions.remove({ channel, name: REACTION, timestamp: ts });
    } catch (err) {
      logger.warn({ err }, "failed_to_remove_reaction");
    }
  } catch (err) {
    logger.error(err);
  }
});

export async function startSlack() {
  await app.start();
  console.log("Slack app (@v2bot) running in Socket Mode");
}

if (import.meta.main) {
  startSlack().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
