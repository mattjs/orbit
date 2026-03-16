import * as readline from "readline";
import type { MessagingAdapter, IncomingMessage } from "../adapter.js";
import type { Message, CommandResult } from "../messages.js";

interface PendingQuestion {
  sessionId: string;
  tmuxSession: string;
  options: string[];
}

interface PendingConfirm {
  actionId: string;
  session: string;
  description: string;
}

export class CliAdapter implements MessagingAdapter {
  private messageHandler: ((msg: IncomingMessage) => Promise<CommandResult>) | null = null;
  private questionHandler: ((sessionId: string, tmuxSession: string, answer: string, userId?: string, channel?: string) => Promise<void>) | null = null;
  private confirmHandler: ((actionId: string, confirmed: boolean, userId?: string, channel?: string) => Promise<void>) | null = null;

  private pendingQuestion: PendingQuestion | null = null;
  private pendingConfirm: PendingConfirm | null = null;
  private rl: readline.Interface | null = null;

  async start(): Promise<void> {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: "\x1b[36morbit>\x1b[0m ",
    });

    this.rl.on("line", async (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) {
        this.rl!.prompt();
        return;
      }

      await this.handleInput(trimmed);
      this.rl!.prompt();
    });

    this.rl.on("close", () => {
      console.log("\nBye.");
      process.exit(0);
    });

    this.rl.prompt();
  }

  async send(_channel: string, message: Message, _threadId?: string): Promise<string | undefined> {
    this.renderMessage(message);

    // Register pending question/confirm
    for (const part of message.parts) {
      if (part.kind === "question") {
        this.pendingQuestion = {
          sessionId: part.id,
          tmuxSession: part.tmuxSession,
          options: part.options,
        };
      } else if (part.kind === "confirm") {
        this.pendingConfirm = {
          actionId: part.actionId,
          session: part.session,
          description: part.description,
        };
      }
    }

    return undefined;
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

  private async handleInput(raw: string): Promise<void> {
    // Try pending question first
    if (this.pendingQuestion) {
      const match = this.matchOption(raw, this.pendingQuestion.options);
      if (match !== null) {
        const pq = this.pendingQuestion;
        this.pendingQuestion = null;
        console.log(`\x1b[32m→ Answered ${pq.sessionId}: ${match}\x1b[0m`);
        if (this.questionHandler) {
          try {
            await this.questionHandler(pq.sessionId, pq.tmuxSession, match, "cli", "cli");
          } catch (err) {
            console.error(`Error: ${err instanceof Error ? err.message : err}`);
          }
        }
        return;
      }
    }

    // Try pending confirm
    if (this.pendingConfirm) {
      const lower = raw.toLowerCase();
      if (/^(y|yes|execute|confirm|ok|do it)$/.test(lower)) {
        const pc = this.pendingConfirm;
        this.pendingConfirm = null;
        console.log(`\x1b[32m→ Confirmed\x1b[0m`);
        if (this.confirmHandler) {
          await this.confirmHandler(pc.actionId, true, "cli", "cli");
        }
        return;
      }
      if (/^(n|no|cancel|abort)$/.test(lower)) {
        const pc = this.pendingConfirm;
        this.pendingConfirm = null;
        console.log(`\x1b[33m→ Cancelled\x1b[0m`);
        if (this.confirmHandler) {
          await this.confirmHandler(pc.actionId, false, "cli", "cli");
        }
        return;
      }
    }

    // Normal command
    if (!this.messageHandler) return;

    const match = raw.match(/^orbit\s*(.*)/i);
    const commandText = match ? (match[1]?.trim() || "help") : raw;

    try {
      const result = await this.messageHandler({
        text: commandText,
        channel: "cli",
        userId: "cli",
      });
      this.renderMessage(result.message);

      // Register pending from result
      for (const part of result.message.parts) {
        if (part.kind === "question") {
          this.pendingQuestion = {
            sessionId: part.id,
            tmuxSession: part.tmuxSession,
            options: part.options,
          };
        } else if (part.kind === "confirm") {
          this.pendingConfirm = {
            actionId: part.actionId,
            session: part.session,
            description: part.description,
          };
        }
      }
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : err}`);
    }
  }

  private matchOption(input: string, options: string[]): string | null {
    const num = parseInt(input, 10);
    if (!isNaN(num) && num >= 1 && num <= options.length) {
      return options[num - 1];
    }

    const lower = input.toLowerCase();
    for (const opt of options) {
      if (opt.toLowerCase() === lower) return opt;
    }
    for (const opt of options) {
      if (opt.toLowerCase().startsWith(lower)) return opt;
    }

    // yes/no shortcuts
    const yesOpts = options.filter((o) => /^(yes|y$|allow|approve|accept|proceed|continue)/i.test(o));
    const noOpts = options.filter((o) => /^(no|n$|deny|reject|cancel|skip|don.?t)/i.test(o));
    if (/^(y|yes|yep|yeah|sure|ok|do it|approve|go ahead)$/i.test(lower) && yesOpts.length === 1) return yesOpts[0];
    if (/^(n|no|nope|nah|cancel|skip|deny|reject)$/i.test(lower) && noOpts.length === 1) return noOpts[0];

    return null;
  }

  private renderMessage(message: Message): void {
    for (const part of message.parts) {
      switch (part.kind) {
        case "header":
          console.log(`\n\x1b[1;37m${part.text}\x1b[0m`);
          break;
        case "text":
          console.log(this.renderMarkdown(part.text));
          break;
        case "code":
          console.log(`\x1b[90m┌─${part.label ? ` ${part.label} ` : ""}──\x1b[0m`);
          for (const line of part.text.split("\n")) {
            console.log(`\x1b[90m│\x1b[0m ${line}`);
          }
          console.log(`\x1b[90m└──\x1b[0m`);
          break;
        case "divider":
          console.log("\x1b[90m" + "─".repeat(50) + "\x1b[0m");
          break;
        case "question":
          console.log(`\n\x1b[33m? ${part.question}\x1b[0m`);
          part.options.forEach((opt, i) => {
            console.log(`  \x1b[36m${i + 1})\x1b[0m ${opt}`);
          });
          console.log(`\x1b[90m  Reply with number or option text\x1b[0m`);
          break;
        case "confirm":
          console.log(`\n\x1b[33m⚡ Confirm: ${part.description}\x1b[0m`);
          console.log(`  \x1b[90mSession: ${part.session}\x1b[0m`);
          console.log(`  \x1b[90mReply yes/no\x1b[0m`);
          break;
      }
    }
  }

  private renderMarkdown(text: string): string {
    return text
      // **bold** → ANSI bold
      .replace(/\*\*(.+?)\*\*/g, "\x1b[1m$1\x1b[22m")
      // `code` → ANSI cyan
      .replace(/`([^`]+)`/g, "\x1b[36m$1\x1b[0m")
      // ## headers
      .replace(/^## (.+)$/gm, "\n\x1b[1;37m$1\x1b[0m")
      .replace(/^### (.+)$/gm, "\n\x1b[37m$1\x1b[0m");
  }
}
