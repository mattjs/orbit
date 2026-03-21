import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import { useNotifications } from "../notifications";
import { useProjectFilter } from "../agentFilter";
import type { Message, MessagePart } from "../types";

interface ChatEntry {
  id: number;
  from: "user" | "orbit" | "system";
  text?: string;
  message?: Message;
  timestamp: Date;
  historical?: boolean;
}

let nextId = 0;

function MessagePartView({
  part,
  onSend,
  onAnswer,
  onConfirm,
  answered,
}: {
  part: MessagePart;
  onSend?: (text: string) => void;
  onAnswer?: (sessionId: string, tmuxSession: string, answer: string) => void;
  onConfirm?: (actionId: string, confirmed: boolean) => void;
  answered?: string | null;
}) {
  switch (part.kind) {
    case "header":
      return <div className="text-sm font-bold text-gray-100 mt-2">{part.text}</div>;
    case "text":
      return <div className="text-sm text-gray-300 whitespace-pre-wrap break-words overflow-hidden" dangerouslySetInnerHTML={{ __html: renderMarkdown(part.text) }} />;
    case "code":
      return (
        <div className="mt-1 mb-1 min-w-0">
          {part.label && <div className="text-xs text-gray-500">{part.label}</div>}
          <pre className="bg-gray-950 border border-gray-800 rounded px-3 py-2 text-xs text-gray-300 overflow-x-auto max-w-full">{part.text}</pre>
        </div>
      );
    case "divider":
      return <hr className="border-gray-800 my-2" />;
    case "question": {
      const isAnswered = answered != null;
      return (
        <div className="mt-1">
          <div className="text-sm text-yellow-300 mb-1">{part.question}</div>
          <div className="flex flex-wrap gap-1.5">
            {part.options.map((opt, i) => {
              const wasChosen = answered === opt;
              return (
                <button
                  key={i}
                  onClick={() => {
                    if (!isAnswered) {
                      onAnswer?.(part.id, part.tmuxSession, opt);
                    }
                  }}
                  disabled={isAnswered}
                  className={`px-2.5 py-1 text-xs rounded transition-colors ${
                    wasChosen
                      ? "bg-blue-900/60 border border-blue-600/60 text-blue-200"
                      : isAnswered
                        ? "bg-gray-800/50 border border-gray-800 text-gray-600 cursor-not-allowed"
                        : "bg-gray-800 border border-gray-700 text-gray-200 hover:bg-gray-700 hover:border-gray-600"
                  }`}
                >
                  {wasChosen && <span className="mr-1">&#10003;</span>}
                  {opt}
                </button>
              );
            })}
          </div>
        </div>
      );
    }
    case "confirm": {
      const isAnswered = answered != null;
      return (
        <div className="mt-1">
          <div className="text-sm text-yellow-300 mb-1">{part.description}</div>
          <div className="flex gap-1.5">
            <button
              onClick={() => !isAnswered && onConfirm?.(part.actionId, true)}
              disabled={isAnswered}
              className={`px-2.5 py-1 text-xs rounded ${
                answered === "execute"
                  ? "bg-red-800/60 border border-red-600/60 text-red-200"
                  : isAnswered
                    ? "bg-gray-800/50 border border-gray-800 text-gray-600 cursor-not-allowed"
                    : "bg-red-900/50 border border-red-700/50 text-red-200 hover:bg-red-800/50"
              }`}
            >
              {answered === "execute" && <span className="mr-1">&#10003;</span>}
              Execute
            </button>
            <button
              onClick={() => !isAnswered && onConfirm?.(part.actionId, false)}
              disabled={isAnswered}
              className={`px-2.5 py-1 text-xs rounded ${
                answered === "cancel"
                  ? "bg-gray-700 border border-gray-600 text-gray-200"
                  : isAnswered
                    ? "bg-gray-800/50 border border-gray-800 text-gray-600 cursor-not-allowed"
                    : "bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700"
              }`}
            >
              {answered === "cancel" && <span className="mr-1">&#10003;</span>}
              Cancel
            </button>
          </div>
        </div>
      );
    }
  }
}

function renderMarkdown(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, '<code class="bg-gray-800 px-1 py-0.5 rounded text-xs text-blue-300">$1</code>')
    .replace(/^## (.+)$/gm, '<div class="text-sm font-semibold text-gray-200 mt-2">$1</div>')
    .replace(/^### (.+)$/gm, '<div class="text-sm font-medium text-gray-300 mt-1">$1</div>')
    .replace(/^- (.+)$/gm, '<div class="pl-3">&bull; $1</div>');
}

function MessageView({
  entry,
  onSend,
  onAnswer,
  onConfirm,
  answeredParts,
}: {
  entry: ChatEntry;
  onSend: (text: string) => void;
  onAnswer: (sessionId: string, tmuxSession: string, answer: string) => void;
  onConfirm: (actionId: string, confirmed: boolean) => void;
  answeredParts: Map<string, string>;
}) {
  if (entry.from === "user") {
    return (
      <div className="flex justify-end mb-3">
        <div className="bg-blue-900/40 border border-blue-800/40 rounded-lg px-3 py-2 max-w-[85%] min-w-0">
          <p className="text-sm text-gray-200 break-words">{entry.text}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-3">
      <div className={`rounded-lg px-3 py-2 max-w-[85%] min-w-0 overflow-hidden ${
        entry.from === "system"
          ? "bg-gray-800/30 border border-gray-800/50"
          : "bg-gray-900 border border-gray-800"
      }`}>
        {entry.message?.parts.map((part, i) => {
          const partKey = part.kind === "question" ? part.id
            : part.kind === "confirm" ? part.actionId
            : undefined;
          // Historical interactive parts are always shown as disabled
          const historicalAnswer = entry.historical && partKey ? "expired" : undefined;
          return (
            <MessagePartView
              key={i}
              part={part}
              onSend={onSend}
              onAnswer={onAnswer}
              onConfirm={onConfirm}
              answered={partKey ? (answeredParts.get(partKey) ?? historicalAnswer ?? null) : null}
            />
          );
        })}
      </div>
      <div className="text-xs text-gray-600 mt-0.5 px-1">
        {entry.timestamp.toLocaleTimeString()}
      </div>
    </div>
  );
}

interface FocusState {
  focused: boolean;
  tmuxSession?: string;
  agentId?: string | null;
}

export function Chat() {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [focus, setFocus] = useState<FocusState>({ focused: false });
  const [answeredParts, setAnsweredParts] = useState<Map<string, string>>(new Map());
  const { selectedProjectPath } = useProjectFilter();
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { messages, markRead, dismissPrompt, dismissConfirm } = useNotifications();
  const lastProcessedRef = useRef(0);

  // Load chat history on mount and when project filter changes
  useEffect(() => {
    setLoaded(false);
    api.getChatHistory(100, selectedProjectPath ?? undefined).then((records) => {
      const restored: ChatEntry[] = records.map((r) => ({
        id: nextId++,
        from: r.sender,
        text: r.userText ?? undefined,
        message: r.messageJson ? JSON.parse(r.messageJson) : undefined,
        timestamp: new Date(r.timestamp),
        historical: true,
      }));
      setEntries(restored);
      // Skip any SSE messages that arrived before/during the fetch — they're already in history
      lastProcessedRef.current = messages.length;
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, [selectedProjectPath]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch focus state on mount and after each send
  const refreshFocus = () => {
    api.getChatFocus().then(setFocus).catch(() => {});
  };
  useEffect(() => { refreshFocus(); }, []);

  // Mark as read when chat is visible
  useEffect(() => { markRead(); }, [entries, markRead]);

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries]);

  // Ingest SSE messages from notification context (only after history is loaded)
  useEffect(() => {
    if (!loaded) return;
    if (messages.length <= lastProcessedRef.current) return;

    const newMessages = messages.slice(lastProcessedRef.current);
    lastProcessedRef.current = messages.length;

    const newEntries: ChatEntry[] = newMessages.map((m) => ({
      id: nextId++,
      from: "system",
      message: m.message,
      timestamp: m.timestamp,
    }));

    setEntries((prev) => [...prev, ...newEntries]);
  }, [messages, loaded]);

  const send = async (text: string) => {
    if (!text.trim()) return;
    const userEntry: ChatEntry = {
      id: nextId++,
      from: "user",
      text: text.trim(),
      timestamp: new Date(),
    };
    setEntries((prev) => [...prev, userEntry]);
    setInput("");
    setSending(true);

    try {
      const result = await api.sendChat(text.trim());
      setEntries((prev) => [...prev, {
        id: nextId++,
        from: "orbit",
        message: result.message,
        timestamp: new Date(),
      }]);
    } catch (err: any) {
      setEntries((prev) => [...prev, {
        id: nextId++,
        from: "orbit",
        message: { parts: [{ kind: "text", text: `Error: ${err.message}` }] },
        timestamp: new Date(),
      }]);
    } finally {
      setSending(false);
      refreshFocus();
      inputRef.current?.focus();
    }
  };

  const handleAnswer = async (sessionId: string, tmuxSession: string, answer: string) => {
    // Mark as answered immediately
    setAnsweredParts((prev) => new Map(prev).set(sessionId, answer));
    dismissPrompt(sessionId);

    try {
      await api.answerQuestion(sessionId, tmuxSession, answer);
      // Add a local entry showing what was sent
      setEntries((prev) => [...prev, {
        id: nextId++,
        from: "user",
        text: `Answered: ${answer}`,
        timestamp: new Date(),
      }]);
    } catch (err: any) {
      setEntries((prev) => [...prev, {
        id: nextId++,
        from: "orbit",
        message: { parts: [{ kind: "text", text: `Error answering: ${err.message}` }] },
        timestamp: new Date(),
      }]);
      // Revert on error
      setAnsweredParts((prev) => {
        const next = new Map(prev);
        next.delete(sessionId);
        return next;
      });
    }
  };

  const handleConfirm = async (actionId: string, confirmed: boolean) => {
    setAnsweredParts((prev) => new Map(prev).set(actionId, confirmed ? "execute" : "cancel"));
    dismissConfirm(actionId);

    try {
      await api.confirmAction(actionId, confirmed);
      setEntries((prev) => [...prev, {
        id: nextId++,
        from: "user",
        text: confirmed ? "Confirmed: Execute" : "Cancelled",
        timestamp: new Date(),
      }]);
    } catch (err: any) {
      setEntries((prev) => [...prev, {
        id: nextId++,
        from: "orbit",
        message: { parts: [{ kind: "text", text: `Error: ${err.message}` }] },
        timestamp: new Date(),
      }]);
      setAnsweredParts((prev) => {
        const next = new Map(prev);
        next.delete(actionId);
        return next;
      });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    send(input);
  };

  const focusIndicator = focus.focused ? (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs rounded-full bg-amber-900/40 border border-amber-700/40 text-amber-300">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
      <span className="hidden sm:inline">Focused:</span> {focus.tmuxSession}
      <button
        onClick={() => send("unfocus")}
        className="ml-1 text-amber-400 hover:text-amber-200"
        title="Unfocus"
      >
        &times;
      </button>
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs rounded-full bg-gray-800/60 border border-gray-700/40 text-gray-400">
      <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
      Orbit NL
    </span>
  );

  const mobileSlot = document.getElementById("header-controls");
  const desktopSlot = document.getElementById("header-controls-desktop");

  return (
    <div className="flex flex-col h-full">
      {mobileSlot && createPortal(focusIndicator, mobileSlot)}
      {desktopSlot && createPortal(focusIndicator, desktopSlot)}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 mb-3 px-1">
        {entries.length === 0 && (
          <p className="text-gray-500 text-sm">
            {focus.focused
              ? `Messages will be sent directly to ${focus.tmuxSession}. Type "unfocus" to switch to Orbit NL.`
              : "Type a command or ask Orbit anything. Use \"focus <session>\" to talk to a session directly."}
          </p>
        )}
        {entries.map((entry) => (
          <MessageView
            key={entry.id}
            entry={entry}
            onSend={send}
            onAnswer={handleAnswer}
            onConfirm={handleConfirm}
            answeredParts={answeredParts}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="shrink-0 flex gap-2">
        <input
          ref={inputRef}
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={sending ? "Sending..." : focus.focused ? `Send to ${focus.tmuxSession}...` : "Message Orbit..."}
          disabled={sending}
          className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-gray-500 focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-500 disabled:opacity-50 shrink-0"
        >
          Send
        </button>
      </form>
    </div>
  );
}
