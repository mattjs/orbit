import type { Message, CommandResult } from "./messages.js";

export interface IncomingMessage {
  text: string;
  channel: string;
  userId?: string;
  threadId?: string;
}

export interface MessagingAdapter {
  start(): Promise<void>;
  send(channel: string, message: Message, threadId?: string): Promise<string | undefined>;
  onMessage(handler: (msg: IncomingMessage) => Promise<CommandResult>): void;
  onQuestionResponse(handler: (sessionId: string, tmuxSession: string, answer: string, userId?: string, channel?: string) => Promise<void>): void;
  onConfirmResponse(handler: (actionId: string, confirmed: boolean, userId?: string, channel?: string) => Promise<void>): void;
}
