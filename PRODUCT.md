# Orbit — Product Overview

A Node.js daemon for monitoring and controlling Claude Code agents on remote machines, with Slack and web interfaces.

## Core Concepts

**Adapter abstraction** — Orbit uses a `MessagingAdapter` interface (`adapter.ts`) that decouples message handling from the transport. Slack, CLI, and web chat all share the same command router, formatters, and message types.

**Message types** — All messages use a platform-agnostic `Message` type (`messages.ts`) with structured parts: text, headers, code blocks, dividers, interactive questions, and confirm buttons. Each adapter renders these appropriately (Block Kit for Slack, React components for web).

**Two-mode watcher** — The background watcher (`watcher.ts`) operates in two modes:
1. **Background (30s poll)** — Posts when message count delta hits threshold, status changes, or agent starts waiting
2. **Active watch (5s poll)** — Triggered after sending a command; reports back with the agent's response, scoped by timestamp to avoid stale text

**Timestamp-based scoping** — Text extraction functions (`getLastAssistantText`, `getLastSubstantiveText`, `getWorkSummary`) accept a `since` parameter to filter JSONL entries by timestamp, ensuring active watches only report work done after the command was sent.

**Tool confirmation** — When the watcher detects pending tool calls (Bash, Write, Edit waiting for user approval), it injects confirm buttons into the posted message. Approving sends "1" (Yes) to the tmux session; canceling sends "3" (No).

## Security

- **Basic auth** on all API endpoints (configurable username/password)
- **TLS** support (cert/key in config)
- **Channel-based auth** for Slack (only messages in configured channels)
- **Command allowlist** — glob patterns for auto-approved tmux sends
- **Confirmation buttons** for non-allowlisted sends
- **Audit log** — all actions logged to SQLite with user, timestamp, and result

## Key Design Decisions

- **SQLite over flat files** — Replaced `history.jsonl` and `audit.jsonl` with SQLite (WAL mode) for concurrent reads, efficient queries, and project/agent relationships
- **Projects as first-class entities** — Projects table links to agents via path matching. Supports multiple tmux sessions, git URL tracking, auto-detection of live sessions
- **SSE for real-time push** — Web chat uses Server-Sent Events for message delivery. All messages posted through `postMessage` are also pushed to SSE subscribers
- **Chat persistence** — Chat messages stored in SQLite (capped at 200). Frontend loads history on mount, deduplicates with SSE stream
- **Opt-in recording** — Watcher poll state can be recorded to `~/.orbit/recordings/` for debugging. Each recording captures parsed session state, JSONL deltas, and watcher decisions
