import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getSetting, appendChatMessage, getRecentChatMessages, getProjectByPath, getAllProjects } from "../db.js";
import { pendingActions } from "../commands/router.js";
import type { Message, CommandResult } from "../messages.js";

type CommandHandler = (text: string, channel: string, userId?: string) => Promise<CommandResult>;
type AnswerHandler = (sessionId: string, tmuxSession: string, answer: string, userId?: string, channel?: string) => Promise<void>;
type ConfirmHandler = (actionId: string, confirmed: boolean, userId?: string, channel?: string) => Promise<void>;

export interface ChatHandlers {
  handleCommand: CommandHandler;
  handleAnswer: AnswerHandler;
  handleConfirm: ConfirmHandler;
}

// SSE subscribers for push messages (watcher updates, etc.)
const subscribers = new Set<(msg: Message) => void>();

/** Derive project path from a Message by scanning its parts for tmux session references */
function deriveProjectPath(message: Message): string | undefined {
  for (const part of message.parts) {
    if (part.kind === "question" && part.tmuxSession) {
      return projectPathForTmux(part.tmuxSession);
    }
    if (part.kind === "confirm" && part.session) {
      return projectPathForTmux(part.session);
    }
  }
  // Try to extract from text like "Sent to `session`:" or "Response from `session`:"
  for (const part of message.parts) {
    if (part.kind === "text") {
      const match = part.text.match(/(?:Sent to|Response from|sending .+ to) `([^`]+)`/);
      if (match) return projectPathForTmux(match[1]);
    }
  }
  return undefined;
}

/** Look up project path for a tmux session name */
function projectPathForTmux(tmuxSession: string): string | undefined {
  try {
    const projects = getAllProjects();
    for (const p of projects) {
      if (p.tmuxSessions.includes(tmuxSession)) return p.path;
    }
  } catch { /* ignore */ }
  return undefined;
}

/** Get project path from the current focus session */
function getFocusProjectPath(): string | undefined {
  const raw = getSetting("focused_session");
  if (!raw) return undefined;
  try {
    const focus = JSON.parse(raw);
    if (focus.tmuxSession) return projectPathForTmux(focus.tmuxSession);
  } catch { /* ignore */ }
  return undefined;
}

export function pushChatMessage(message: Message, projectPath?: string): void {
  // Persist system push messages
  try {
    const resolved = projectPath ?? deriveProjectPath(message);
    appendChatMessage({
      timestamp: new Date().toISOString(),
      sender: "system",
      messageJson: JSON.stringify(message),
      projectPath: resolved,
    });
  } catch { /* best-effort */ }

  console.log(`[chat] Pushing message to ${subscribers.size} SSE subscriber(s)`);
  for (const cb of subscribers) {
    try { cb(message); } catch { /* ignore */ }
  }
}

export function chatRoutes(handlers: ChatHandlers): Hono {
  const { handleCommand, handleAnswer, handleConfirm } = handlers;
  const app = new Hono();

  // Load chat history
  app.get("/chat/history", (c) => {
    const limit = Math.min(parseInt(c.req.query("limit") ?? "100"), 200);
    const projectPath = c.req.query("project") || undefined;
    const rows = getRecentChatMessages(limit, projectPath);
    return c.json(rows);
  });

  // Send a message and get a response
  app.post("/chat", async (c) => {
    const body = await c.req.json<{ text: string }>();
    if (!body.text?.trim()) {
      return c.json({ error: "Missing text" }, 400);
    }

    try {
      const projectPath = getFocusProjectPath();

      // Persist user message
      appendChatMessage({
        timestamp: new Date().toISOString(),
        sender: "user",
        userText: body.text.trim(),
        projectPath,
      });

      const result = await handleCommand(body.text.trim(), "web", "web");

      // Persist orbit response — derive project from response or focus
      const responseProject = deriveProjectPath(result.message) ?? projectPath;
      appendChatMessage({
        timestamp: new Date().toISOString(),
        sender: "orbit",
        messageJson: JSON.stringify(result.message),
        projectPath: responseProject,
      });

      return c.json({ message: result.message, text: result.text });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  // Answer a question prompt from a Claude agent
  app.post("/chat/answer", async (c) => {
    const body = await c.req.json<{ sessionId: string; tmuxSession: string; answer: string }>();
    if (!body.sessionId || !body.tmuxSession || !body.answer) {
      return c.json({ error: "Missing sessionId, tmuxSession, or answer" }, 400);
    }

    try {
      const projectPath = projectPathForTmux(body.tmuxSession);
      appendChatMessage({
        timestamp: new Date().toISOString(),
        sender: "user",
        userText: `Answered: ${body.answer}`,
        projectPath,
      });

      await handleAnswer(body.sessionId, body.tmuxSession, body.answer, "web", "web");
      return c.json({ ok: true });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  // Confirm or cancel a pending action
  app.post("/chat/confirm", async (c) => {
    const body = await c.req.json<{ actionId: string; confirmed: boolean }>();
    if (!body.actionId || typeof body.confirmed !== "boolean") {
      return c.json({ error: "Missing actionId or confirmed" }, 400);
    }

    try {
      // Look up project from the pending action's session
      const pending = pendingActions.get(body.actionId);
      const projectPath = pending ? projectPathForTmux(pending.session) : undefined;

      appendChatMessage({
        timestamp: new Date().toISOString(),
        sender: "user",
        userText: body.confirmed ? "Confirmed: Execute" : "Cancelled",
        projectPath,
      });

      await handleConfirm(body.actionId, body.confirmed, "web", "web");
      return c.json({ ok: true });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  // Get current focus state
  app.get("/chat/focus", (c) => {
    const raw = getSetting("focused_session");
    if (!raw) return c.json({ focused: false });
    try {
      const focus = JSON.parse(raw);
      return c.json({ focused: true, tmuxSession: focus.tmuxSession, agentId: focus.agentId });
    } catch {
      return c.json({ focused: false });
    }
  });

  // SSE stream for push messages
  app.get("/chat/events", (c) => {
    return streamSSE(c, async (stream) => {
      const send = (msg: Message) => {
        stream.writeSSE({ data: JSON.stringify(msg), event: "message" }).catch(() => {});
      };

      subscribers.add(send);

      // Keep-alive ping every 30s
      const ping = setInterval(() => {
        stream.writeSSE({ data: "", event: "ping" }).catch(() => {});
      }, 30_000);

      // Wait until client disconnects
      stream.onAbort(() => {
        subscribers.delete(send);
        clearInterval(ping);
      });

      // Block to keep the stream open
      await new Promise(() => {});
    });
  });

  return app;
}
