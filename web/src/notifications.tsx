import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { Message, MessagePart } from "./types";

interface PendingPrompt {
  id: string;
  tmuxSession: string;
  question: string;
  options: string[];
  timestamp: Date;
}

interface PendingConfirm {
  actionId: string;
  session: string;
  description: string;
  timestamp: Date;
}

interface Toast {
  id: number;
  text: string;
  timestamp: Date;
}

interface NotificationState {
  /** Messages pushed via SSE (watcher updates, active watch results) */
  messages: Array<{ id: number; message: Message; timestamp: Date }>;
  /** Unread count (resets when chat is viewed) */
  unreadCount: number;
  /** Active prompts waiting for answers */
  pendingPrompts: PendingPrompt[];
  /** Active confirms waiting for response */
  pendingConfirms: PendingConfirm[];
  /** Toast notifications */
  toasts: Toast[];
}

interface NotificationContextValue extends NotificationState {
  markRead: () => void;
  dismissToast: (id: number) => void;
  dismissPrompt: (id: string) => void;
  dismissConfirm: (actionId: string) => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

let nextMsgId = 0;
let nextToastId = 0;

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<NotificationState>({
    messages: [],
    unreadCount: 0,
    pendingPrompts: [],
    pendingConfirms: [],
    toasts: [],
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  // SSE connection — always active at app level
  useEffect(() => {
    const es = new EventSource("/api/chat/events");

    es.addEventListener("message", (e) => {
      try {
        const message = JSON.parse(e.data) as Message;
        const msgId = nextMsgId++;
        const now = new Date();

        // Extract pending prompts and confirms from the message
        const newPrompts: PendingPrompt[] = [];
        const newConfirms: PendingConfirm[] = [];
        let toastText = "";

        for (const part of message.parts) {
          if (part.kind === "question") {
            newPrompts.push({
              id: part.id,
              tmuxSession: part.tmuxSession,
              question: part.question,
              options: part.options,
              timestamp: now,
            });
            toastText = `Agent waiting: ${part.question.split("\n")[0].slice(0, 80)}`;
          } else if (part.kind === "confirm") {
            newConfirms.push({
              actionId: part.actionId,
              session: part.session,
              description: part.description,
              timestamp: now,
            });
            toastText = `Confirm: ${part.description.slice(0, 80)}`;
          }
        }

        // If no prompt/confirm, generate toast from first text part
        if (!toastText) {
          const textPart = message.parts.find((p): p is Extract<MessagePart, { kind: "text" }> => p.kind === "text");
          if (textPart) {
            toastText = textPart.text.slice(0, 100);
          }
        }

        setState((prev) => ({
          ...prev,
          messages: [...prev.messages, { id: msgId, message, timestamp: now }],
          unreadCount: prev.unreadCount + 1,
          pendingPrompts: [
            ...prev.pendingPrompts.filter((p) => !newPrompts.some((np) => np.id === p.id)),
            ...newPrompts,
          ],
          pendingConfirms: [
            ...prev.pendingConfirms.filter((c) => !newConfirms.some((nc) => nc.actionId === c.actionId)),
            ...newConfirms,
          ],
          toasts: toastText
            ? [...prev.toasts, { id: nextToastId++, text: toastText, timestamp: now }]
            : prev.toasts,
        }));

        // Browser notification for prompts
        if (newPrompts.length > 0 && document.hidden && Notification.permission === "granted") {
          new Notification("Orbit — Agent waiting", {
            body: newPrompts[0].question.split("\n")[0].slice(0, 100),
            tag: "orbit-prompt",
          });
        }
      } catch { /* ignore */ }
    });

    return () => es.close();
  }, []);

  // Auto-dismiss toasts after 6s
  useEffect(() => {
    if (state.toasts.length === 0) return;
    const timer = setTimeout(() => {
      setState((prev) => ({
        ...prev,
        toasts: prev.toasts.filter((t) => Date.now() - t.timestamp.getTime() < 6000),
      }));
    }, 6000);
    return () => clearTimeout(timer);
  }, [state.toasts]);

  // Request notification permission on first prompt
  useEffect(() => {
    if (state.pendingPrompts.length > 0 && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, [state.pendingPrompts.length]);

  const markRead = useCallback(() => {
    setState((prev) => ({ ...prev, unreadCount: 0 }));
  }, []);

  const dismissToast = useCallback((id: number) => {
    setState((prev) => ({ ...prev, toasts: prev.toasts.filter((t) => t.id !== id) }));
  }, []);

  const dismissPrompt = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      pendingPrompts: prev.pendingPrompts.filter((p) => p.id !== id),
    }));
  }, []);

  const dismissConfirm = useCallback((actionId: string) => {
    setState((prev) => ({
      ...prev,
      pendingConfirms: prev.pendingConfirms.filter((c) => c.actionId !== actionId),
    }));
  }, []);

  return (
    <NotificationContext.Provider
      value={{ ...state, markRead, dismissToast, dismissPrompt, dismissConfirm }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotifications must be used within NotificationProvider");
  return ctx;
}

/** Toast container — render at layout level */
export function ToastContainer() {
  const { toasts, dismissToast } = useNotifications();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 shadow-lg animate-in slide-in-from-right"
        >
          <div className="flex items-start gap-2">
            <span className="text-yellow-400 text-sm shrink-0">!</span>
            <p className="text-sm text-gray-200 flex-1">{toast.text}</p>
            <button
              onClick={() => dismissToast(toast.id)}
              className="text-gray-500 hover:text-gray-300 text-sm shrink-0"
            >
              &times;
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
