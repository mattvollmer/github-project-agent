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

async function runAgentSession(args: { userText: string; channel: string; thread_ts: string; client: any }) {
  const { userText, channel, thread_ts, client } = args;

  if (!userText || userText.trim().length === 0) {
    await client.chat.postMessage({ channel, thread_ts, text: "Ask me about your GitHub Projects. For example:\n- what's new in the last 7 days for Project X?\n- list items in Project X with Status = In Progress\n- show all changes for repo owner/repo in Project X" });
    return;
  }

  let currentMessageTs: string | null = null;
  let accumulatedText = "";
  let toolsExecuted = 0;

  try {
    const result = streamText({
      model: "anthropic/claude-sonnet-4",
      system: buildSystemPrompt(),
      messages: [{ role: "user", content: userText }],
      tools: {
        db_schema: tool({
          description: "Return the schema and usage notes for the Neon database backing GitHub Project insights. Includes tables, columns, indexes, and a concise guide for common queries using project_name.",
          inputSchema: z.object({}),
          execute: async () => {
            console.log("[DEBUG] Executing db_schema tool");
            toolsExecuted++;
            const schema = await getSchema();
            return schema;
          },
        }),
        db_query: tool({
          description: "Execute a read-only SQL SELECT against the Neon database. Use project_name for scoping; default lookback is the last 7 days for 'what's new' queries. Returns rows with enforced LIMIT/OFFSET (max 2000).",
          inputSchema: z.object({
            sql: z.string().describe("A single SELECT (or WITH ... SELECT) statement."),
            params: z.array(z.any()).optional().default([]),
            limit: z.number().int().min(1).max(2000).optional().default(200),
            offset: z.number().int().min(0).optional().default(0),
            timeoutMs: z.number().int().min(1000).max(60000).optional().default(15000),
          }),
          execute: async ({ sql, params, limit, offset, timeoutMs }) => {
            console.log("[DEBUG] Executing db_query tool with SQL:", sql);
            toolsExecuted++;
            const result = await runQuery({ sql, params, limit, offset, timeoutMs });
            console.log("[DEBUG] db_query returned", result.rows?.length || 0, "rows");
            return result;
          },
        }),
      },
    });

    // Stream the response and update Slack message
    let lastUpdateTime = Date.now();
    const updateThrottle = 1000; // Update at most once per second
    
    for await (const delta of result.textStream) {
      accumulatedText += delta;
      
      const clean = stripMonocle(accumulatedText);
      const now = Date.now();
      
      // Throttle updates to avoid rate limits
      if (now - lastUpdateTime >= updateThrottle || delta.includes('\n')) {
        if (currentMessageTs) {
          try {
            await client.chat.update({
              channel,
              ts: currentMessageTs,
              text: clean,
            });
            lastUpdateTime = now;
          } catch (updateErr) {
            console.warn("[DEBUG] Failed to update message:", updateErr);
          }
        } else {
          const response = await client.chat.postMessage({
            channel,
            thread_ts,
            text: clean,
          });
          currentMessageTs = response.ts;
          lastUpdateTime = now;
        }
      }
    }

    // Critical: Wait for ALL tool results to complete
    console.log("[DEBUG] Waiting for final text and tool results...");
    const finalText = await result.text;
    const toolResults = await result.toolResults;
    
    console.log("[DEBUG] Final text length:", finalText.length);
    console.log("[DEBUG] Tools executed:", toolsExecuted);
    console.log("[DEBUG] Tool results:", toolResults.length);
    console.log("[DEBUG] Final text preview:", finalText.slice(0, 200) + '...');
    
    // If we have tool results but the text is incomplete, construct a complete response
    let completeText = finalText;
    if (toolResults.length > 0 && finalText.length < 200) {
      console.log("[DEBUG] Text seems incomplete, constructing response from tool results");
      console.log("[DEBUG] Tool results structure:", JSON.stringify(toolResults, null, 2));
      
      // Find the db_query result - cast to any to handle the complex typing
      const dbQueryResult = (toolResults as any[]).find((r: any) => r.toolName === 'db_query');
      if (dbQueryResult) {
        console.log("[DEBUG] Found db_query result:", JSON.stringify(dbQueryResult, null, 2));
        
        // Try different property names that might contain the result
        const resultData = dbQueryResult.result || dbQueryResult.value || dbQueryResult.output || dbQueryResult;
        const rows = resultData?.rows;
        
        if (rows && Array.isArray(rows) && rows.length > 0) {
          // Check if this looks like a project name query
          const firstRow = rows[0];
          if (firstRow && typeof firstRow === 'object' && 'project_name' in firstRow) {
            const projectNames = rows.map((row: any) => row.project_name).filter(Boolean);
            completeText = `I found ${projectNames.length} projects in the database:\n\n${projectNames.map((name: string) => `• ${name}`).join('\n')}`;
          } else {
            // Generic result display
            completeText = `Query completed successfully. Found ${rows.length} result(s).\n\nResults:\n${JSON.stringify(rows.slice(0, 5), null, 2)}`;
          }
        } else {
          completeText = "Query executed but no results found or result format unexpected.";
        }
      }
    }
    
    // Always do a final update with complete results
    const finalClean = stripMonocle(completeText);
    if (currentMessageTs) {
      await client.chat.update({
        channel,
        ts: currentMessageTs,
        text: finalClean,
      });
      console.log("[DEBUG] Final update completed with:", finalClean.slice(0, 100) + '...');
    } else {
      await client.chat.postMessage({
        channel,
        thread_ts,
        text: finalClean,
      });
      console.log("[DEBUG] Final post completed with:", finalClean.slice(0, 100) + '...');
    }

    // If no tools were executed but the query suggests they should be, add a follow-up
    if (toolsExecuted === 0 && (userText.toLowerCase().includes('project') || userText.toLowerCase().includes('database'))) {
      await client.chat.postMessage({
        channel,
        thread_ts,
        text: `[Debug] No database tools were executed. Tools available: db_schema, db_query. Please be more specific about what data you need.`,
      });
    }

  } catch (err: any) {
    console.error("[DEBUG] Error in runAgentSession:", err);
    const msg = typeof err?.message === "string" ? err.message.slice(0, 600) : "unexpected_error";
    await client.chat.postMessage({ channel, thread_ts, text: `Encountered an error: ${msg}` });
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