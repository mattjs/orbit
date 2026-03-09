export type MessagePart =
  | { kind: "header"; text: string }
  | { kind: "text"; text: string }
  | { kind: "code"; text: string; label?: string }
  | { kind: "divider" }
  | { kind: "question"; id: string; tmuxSession: string; question: string; options: string[] }
  | { kind: "confirm"; actionId: string; session: string; description: string };

export interface Message {
  parts: MessagePart[];
}

export interface CommandResult {
  message: Message;
  text: string;
}
