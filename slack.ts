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

function stripMonocle(input: string): string {
  return (input || "")
    .replace(/:face_with_monocle:|:monocle_face:/g, "")
    .replace(/\u{1F9D0}\uFE0F?/gu, "")
    .replace(/^\s+/, "")
    .trim();
}

async function runAgentOnce(userText: string): Promise<string> {
  if (!userText || userText.trim().length === 0) {
    return "Ask me about your GitHub Projects. Examples:\n- what's new in the last 7 days for Project X?\n- list items in Project X with Status = In Progress\n- show all changes for repo owner/repo in Project X";
  }
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
  return stripMonocle(text);
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

  try {
    // Add thinking face reaction
    try {
      await client.reactions.add({ channel, name: REACTION, timestamp: ts });
    } catch (err) {
      logger.warn({ err }, "failed_to_add_reaction");
    }

    const answer = stripMonocle(await runAgentOnce(userText));

    // Post a message as a reply
    await client.chat.postMessage({
      channel,
      text: stripMonocle(answer),
      mrkdwn: true as any,
      thread_ts: (event as any).thread_ts || (event as any).ts,
    });
  } catch (err) {
    logger.error(err);
  } finally {
    // Ensure the reaction is removed
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

  try {
    try {
      await client.reactions.add({ channel, name: REACTION, timestamp: ts });
    } catch (err) {
      logger.warn({ err }, "failed_to_add_reaction");
    }

    const answer = stripMonocle(await runAgentOnce(e.text || ""));
    await client.chat.postMessage({
      channel,
      text: stripMonocle(answer),
      mrkdwn: true as any,
      thread_ts: e.thread_ts || e.ts,
    });
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
