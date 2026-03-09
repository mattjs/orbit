import { App } from "@slack/bolt";
import type { KnownBlock } from "@slack/types";
import type { Config } from "../config.js";
import type { MessagingAdapter, IncomingMessage } from "../adapter.js";
import type { Message, MessagePart, CommandResult } from "../messages.js";

interface PendingQuestion {
  sessionId: string;
  tmuxSession: string;
  options: string[];
  expiresAt: number;
}

interface PendingConfirm {
  actionId: string;
  session: string;
  description: string;
  expiresAt: number;
}

const PENDING_TTL_MS = 120_000;

export class SlackAdapter implements MessagingAdapter {
  private app: App;
  private config: Config;
  private messageHandler: ((msg: IncomingMessage) => Promise<CommandResult>) | null = null;
  private questionHandler: ((sessionId: string, tmuxSession: string, answer: string, userId?: string, channel?: string) => Promise<void>) | null = null;
  private confirmHandler: ((actionId: string, confirmed: boolean, userId?: string, channel?: string) => Promise<void>) | null = null;

  // Track pending questions per channel
  private pendingQuestions = new Map<string, PendingQuestion>();
  // Track pending confirms by actionId
  private pendingConfirms = new Map<string, PendingConfirm>();

  constructor(config: Config) {
    this.config = config;
    this.app = new App({
      token: config.slack.botToken,
      appToken: config.slack.appToken,
      socketMode: true,
    });

    this.setupListeners();
  }

  async start(): Promise<void> {
    await this.app.start();
    console.log("Orbit bot is running (Socket Mode)");
  }

  async send(channel: string, message: Message, threadId?: string): Promise<string | undefined> {
    // Scan for question/confirm parts and register them as pending
    this.registerPending(channel, message);

    const blocks = this.renderSlackBlocks(message);
    const text = this.extractPlainText(message);

    const result = await this.app.client.chat.postMessage({
      channel,
      blocks,
      text,
      thread_ts: threadId,
    });
    return result.ts ?? undefined;
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<CommandResult>): void {
    this.messageHandler = handler;
  }

  onQuestionResponse(handler: (sessionId: string, tmuxSession: string, answer: string, userId?: string, channel?: string) => Promise<void>): void {
    this.questionHandler = handler;
  }

  onConfirmResponse(handler: (actionId: string, confirmed: boolean, userId?: string, channel?: string) => Promise<void>): void {
    this.confirmHandler = handler;
  }

  private setupListeners(): void {
    // Listen to channel messages
    this.app.message(async ({ message, say }) => {
      if (!("text" in message) || message.subtype) return;
      if (message.channel !== this.config.slack.channel) return;
      if ("bot_id" in message && (message as any).bot_id) return;

      const raw = (message as { text?: string }).text?.trim() || "";
      if (!raw) return;

      const channel = message.channel;
      const userId = "user" in message ? (message as { user?: string }).user : undefined;
      const threadTs = "thread_ts" in message ? (message as any).thread_ts : undefined;

      // Check pending questions first
      if (await this.tryResolvePending(raw, channel, userId, threadTs, say)) return;

      // Normal command handling
      await this.handleIncoming(raw, channel, userId, threadTs, say);
    });

    // Listen for app mentions
    this.app.event("app_mention", async ({ event, say }) => {
      const rawText = event.text.replace(/<@[A-Z0-9]+>/g, "").trim();
      const channel = event.channel;
      const userId = event.user;
      const threadTs = event.thread_ts;

      // Check pending questions first
      if (await this.tryResolvePending(rawText, channel, userId, threadTs, say)) return;

      await this.handleIncoming(rawText, channel, userId, threadTs, say);
    });

    // Interactive button handlers for progressive enhancement
    this.setupButtonHandlers();
  }

  private setupButtonHandlers(): void {
    // Answer prompt buttons (progressive enhancement — also works via text)
    this.app.action(/^answer_prompt_\d+$/, async ({ ack, body, say }) => {
      await ack();
      try {
        const action = (body as any).actions?.[0];
        const payload = JSON.parse(action.value);
        const { sessionId, tmuxSession, answer } = payload;
        const userId = body.user?.id;
        const messageTs = (body as any).message?.ts;

        if (this.questionHandler) {
          await this.questionHandler(sessionId, tmuxSession, answer, userId, this.config.slack.channel);
        }

        await say({ text: `Answered \`${sessionId}\` with: \`${answer}\``, thread_ts: messageTs });
      } catch (err) {
        console.error("Answer prompt error:", err);
        await say({ text: `Error: ${err instanceof Error ? err.message : "Unknown error"}`, thread_ts: (body as any).message?.ts });
      }
    });

    // Confirm send button
    this.app.action("confirm_send", async ({ ack, body, say }) => {
      await ack();
      try {
        const action = (body as any).actions?.[0];
        const payload = JSON.parse(action.value);
        const { actionId } = payload;
        const userId = body.user?.id;
        const messageTs = (body as any).message?.ts;

        this.pendingConfirms.delete(actionId);

        if (this.confirmHandler) {
          await this.confirmHandler(actionId, true, userId, this.config.slack.channel);
        }

        await say({ text: `Confirmed.`, thread_ts: messageTs });
      } catch (err) {
        console.error("Confirm send error:", err);
        await say({ text: `Error: ${err instanceof Error ? err.message : "Unknown error"}`, thread_ts: (body as any).message?.ts });
      }
    });

    // Cancel send button
    this.app.action("cancel_send", async ({ ack, body, say }) => {
      await ack();
      try {
        const action = (body as any).actions?.[0];
        const payload = JSON.parse(action.value);
        const { actionId } = payload;
        const userId = body.user?.id;
        const messageTs = (body as any).message?.ts;

        this.pendingConfirms.delete(actionId);

        if (this.confirmHandler) {
          await this.confirmHandler(actionId, false, userId, this.config.slack.channel);
        }

        await say({ text: `Cancelled.`, thread_ts: messageTs });
      } catch (err) {
        console.error("Cancel send error:", err);
        await say({ text: `Error: ${err instanceof Error ? err.message : "Unknown error"}`, thread_ts: (body as any).message?.ts });
      }
    });
  }

  /** Try to resolve a pending question or confirm from the user's message text */
  private async tryResolvePending(
    raw: string,
    channel: string,
    userId: string | undefined,
    threadTs: string | undefined,
    say: (args: any) => Promise<any>
  ): Promise<boolean> {
    this.cleanupExpired();

    // Check pending questions for this channel
    const pending = this.pendingQuestions.get(channel);
    if (pending) {
      const trimmed = raw.trim();
      const match = this.matchQuestionOption(trimmed, pending.options);
      if (match !== null) {
        this.pendingQuestions.delete(channel);
        if (this.questionHandler) {
          try {
            await this.questionHandler(pending.sessionId, pending.tmuxSession, match, userId, channel);
            await say({ text: `Answered \`${pending.sessionId}\` with: \`${match}\``, thread_ts: threadTs });
          } catch (err) {
            console.error("Question response error:", err);
            await say({ text: `Error: ${err instanceof Error ? err.message : "Unknown error"}`, thread_ts: threadTs });
          }
        }
        return true;
      }
    }

    // Check pending confirms — look for yes/execute/cancel
    if (this.pendingConfirms.size > 0) {
      const lower = raw.trim().toLowerCase();
      if (/^(yes|y|execute|confirm|do it|ok)$/i.test(lower)) {
        // Resolve the most recent pending confirm
        const [actionId] = [...this.pendingConfirms.keys()].slice(-1);
        if (actionId) {
          this.pendingConfirms.delete(actionId);
          if (this.confirmHandler) {
            try {
              await this.confirmHandler(actionId, true, userId, channel);
              await say({ text: `Confirmed.`, thread_ts: threadTs });
            } catch (err) {
              console.error("Confirm response error:", err);
              await say({ text: `Error: ${err instanceof Error ? err.message : "Unknown error"}`, thread_ts: threadTs });
            }
          }
          return true;
        }
      } else if (/^(no|n|cancel|abort|stop)$/i.test(lower)) {
        const [actionId] = [...this.pendingConfirms.keys()].slice(-1);
        if (actionId) {
          this.pendingConfirms.delete(actionId);
          if (this.confirmHandler) {
            try {
              await this.confirmHandler(actionId, false, userId, channel);
              await say({ text: `Cancelled.`, thread_ts: threadTs });
            } catch (err) {
              console.error("Confirm response error:", err);
              await say({ text: `Error: ${err instanceof Error ? err.message : "Unknown error"}`, thread_ts: threadTs });
            }
          }
          return true;
        }
      }
    }

    return false;
  }

  /** Match user input against question options by number or text */
  private matchQuestionOption(input: string, options: string[]): string | null {
    // Try numeric match: "1", "2", etc.
    const num = parseInt(input, 10);
    if (!isNaN(num) && num >= 1 && num <= options.length) {
      return options[num - 1];
    }

    // Try exact text match (case-insensitive)
    const lower = input.toLowerCase();
    for (const opt of options) {
      if (opt.toLowerCase() === lower) return opt;
    }

    return null;
  }

  private async handleIncoming(
    raw: string,
    channel: string,
    userId: string | undefined,
    threadTs: string | undefined,
    say: (args: any) => Promise<any>
  ): Promise<void> {
    if (!this.messageHandler) return;

    const match = raw.match(/^orbit\s*(.*)/i);
    const commandText = match ? (match[1]?.trim() || "help") : raw;

    try {
      const result = await this.messageHandler({
        text: commandText,
        channel,
        userId,
        threadId: threadTs,
      });

      // Register any pending questions/confirms from the result
      this.registerPending(channel, result.message);

      const blocks = this.renderSlackBlocks(result.message);
      await say({ blocks, text: result.text, thread_ts: threadTs });
    } catch (err) {
      console.error("Command error:", err);
      await say({ text: `Error: ${err instanceof Error ? err.message : "Unknown error"}`, thread_ts: threadTs });
    }
  }

  /** Register pending questions and confirms from outgoing messages */
  private registerPending(channel: string, message: Message): void {
    for (const part of message.parts) {
      if (part.kind === "question") {
        this.pendingQuestions.set(channel, {
          sessionId: part.id,
          tmuxSession: part.tmuxSession,
          options: part.options,
          expiresAt: Date.now() + PENDING_TTL_MS,
        });
      } else if (part.kind === "confirm") {
        this.pendingConfirms.set(part.actionId, {
          actionId: part.actionId,
          session: part.session,
          description: part.description,
          expiresAt: Date.now() + PENDING_TTL_MS,
        });
      }
    }
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [key, q] of this.pendingQuestions) {
      if (now > q.expiresAt) this.pendingQuestions.delete(key);
    }
    for (const [key, c] of this.pendingConfirms) {
      if (now > c.expiresAt) this.pendingConfirms.delete(key);
    }
  }

  // --- Rendering ---

  /** Convert generic Message to Slack Block Kit blocks */
  renderSlackBlocks(message: Message): KnownBlock[] {
    const blocks: KnownBlock[] = [];

    for (const part of message.parts) {
      switch (part.kind) {
        case "header":
          blocks.push({
            type: "header",
            text: { type: "plain_text", text: part.text },
          });
          break;

        case "text":
          blocks.push({
            type: "section",
            text: { type: "mrkdwn", text: this.toSlackMrkdwn(part.text) },
          });
          break;

        case "code":
          blocks.push({
            type: "section",
            text: { type: "mrkdwn", text: `\`\`\`\n${part.text}\n\`\`\`` },
          });
          break;

        case "divider":
          blocks.push({ type: "divider" });
          break;

        case "question": {
          // Render as text with numbered options + interactive buttons
          const optionsList = part.options
            .slice(0, 5)
            .map((opt, i) => `${i + 1}) ${opt}`)
            .join("  ");
          blocks.push({
            type: "section",
            text: { type: "mrkdwn", text: `${optionsList}\n_Reply with your choice._` },
          });

          // Progressive enhancement: also add interactive buttons
          const elements = part.options.slice(0, 5).map((opt, i) => {
            const btn: Record<string, unknown> = {
              type: "button",
              text: { type: "plain_text", text: opt.slice(0, 75) },
              action_id: `answer_prompt_${i}`,
              value: JSON.stringify({
                sessionId: part.id,
                tmuxSession: part.tmuxSession,
                answer: opt,
              }),
            };
            const lower = opt.toLowerCase();
            if (lower === "yes" || lower === "y") btn.style = "primary";
            if (lower === "no" || lower === "n") btn.style = "danger";
            return btn;
          });
          blocks.push({ type: "actions", elements } as KnownBlock);
          break;
        }

        case "confirm": {
          // Render text + interactive buttons
          blocks.push({
            type: "section",
            text: { type: "mrkdwn", text: `_Reply "yes" to execute or "cancel" to abort._` },
          });
          blocks.push({
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "Execute" },
                style: "danger",
                action_id: "confirm_send",
                value: JSON.stringify({
                  actionId: part.actionId,
                  session: part.session,
                  text: part.description,
                }),
              },
              {
                type: "button",
                text: { type: "plain_text", text: "Cancel" },
                action_id: "cancel_send",
                value: JSON.stringify({
                  actionId: part.actionId,
                  session: part.session,
                  text: part.description,
                }),
              },
            ],
          } as KnownBlock);
          break;
        }
      }
    }

    return blocks;
  }

  /** Convert generic markdown to Slack mrkdwn */
  toSlackMrkdwn(text: string): string {
    // **bold** → *bold*
    return text.replace(/\*\*(.+?)\*\*/g, "*$1*");
  }

  /** Extract a plain text summary from a Message */
  private extractPlainText(message: Message): string {
    const textParts: string[] = [];
    for (const part of message.parts) {
      if (part.kind === "header" || part.kind === "text") {
        textParts.push(part.text);
      }
    }
    return textParts.join(" ").slice(0, 200) || "Orbit message";
  }
}
