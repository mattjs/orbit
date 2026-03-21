# Orbit Development Checklist

## Core Infrastructure

- [x] Slack bot via Bolt SDK (Socket Mode)
- [x] CLI adapter (readline-based, for local testing)
- [x] MessagingAdapter interface (decoupled from Slack)
- [x] Platform-agnostic message types (MessagePart, Message)
- [x] YAML config loader (`~/.orbit/config.yaml`)
- [x] SQLite database (WAL mode) — replaced flat JSONL files
- [x] systemd service unit
- [x] tsup (server) + vite (web) build pipeline
- [x] TLS support (cert/key in config)
- [x] Basic auth middleware for API

## Monitoring

- [x] System health (CPU, memory, disk, uptime)
- [x] Claude Code session discovery via tmux + `/proc`
- [x] JSONL conversation log parsing (messages, tool calls, status)
- [x] Session status derivation (executing, thinking, waiting, idle)
- [x] Waiting question extraction (AskUserQuestion with options)
- [x] Git repo status monitoring (branch, ahead/behind, dirty files)
- [x] AI-powered session summaries via Claude Haiku (incremental, context-preserving)
- [x] Session snapshot history (SQLite)

## Background Agent Watcher

- [x] 30s background poll for all sessions
- [x] Message count delta threshold for periodic posts (default 10)
- [x] Status transition detection and posting
- [x] Waiting question immediate notification
- [x] First-seen sessions recorded silently (no startup dump)
- [x] Post-command active watches (5s poll, timestamp-based scoping)
- [x] Active watch auto-expiry (soft 15s, hard 120s)
- [x] Active watches skip background poll (no duplicate posts)
- [x] Timestamp-based text extraction (`since` parameter on all extraction functions)
- [x] Work footer filtering (only shown when agent edited files, read-only tools excluded)
- [x] Tool confirmation injection (Bash/Write/Edit pending → approve/deny buttons)
- [x] Opt-in poll recording for debugging (`~/.orbit/recordings/`)
- [ ] Configurable background poll interval (currently hardcoded 30s)

## Commands

- [x] `status` — system health
- [x] `agents` — list sessions with AI summaries
- [x] `agent <id>` — deep dive on single session
- [x] `git` / `git <repo>` — git status
- [x] `report` — full combined report
- [x] `history` / `history <id>` — session snapshots
- [x] `watch <minutes>` / `stop` — periodic reporting
- [x] `sessions` — list tmux sessions
- [x] `capture <session>` — raw pane content
- [x] `send <session> <text>` — send keystrokes
- [x] `answer <agent-id> <text>` — answer agent question
- [x] `focus` / `unfocus` — session focus for NL routing
- [x] `audit` — action audit log
- [x] `record on|off|status` — toggle watcher recording
- [x] `recordings` — list recorded sessions
- [x] `help` — command reference

## Actions & Safety

- [x] Dangerous command confirmation via buttons (confirm/cancel)
- [x] Allowlist patterns for auto-approved commands
- [x] tmux pane capture with diff detection (before/after send)
- [x] Stable output polling (waitForStableOutput)
- [x] Audit trail with timestamps, user attribution, input/output
- [x] Watcher-originated confirm buttons for pending tool calls

## Natural Language Interface

- [x] Claude Haiku-powered NL interpretation
- [x] System context injection (agents, status, tmux sessions)
- [x] Session focus awareness ("say yes" routes to focused session)
- [x] Direct answers from context vs. command routing

## Interactive Prompts

- [x] Structured prompt parsing (WaitingPrompt with question + options)
- [x] Yes/No and multiple choice button rendering
- [x] Summary context above questions
- [x] Watcher integration (button click → tmux send → active watch)
- [x] Button state management (answered buttons show checkmark, disabled)
- [x] Confirm buttons for pending Bash/Write/Edit tool calls
- [ ] Free-text fallback for open-ended questions (currently requires `answer` command)

## Web Dashboard

- [x] React 19 + Vite + Tailwind v4 SPA
- [x] Project list with agent counts, live indicators
- [x] Project detail — agents, git status, tmux sessions, launch button
- [x] Agent list and detail views
- [x] Timeline (session snapshots)
- [x] Audit log viewer
- [x] Real-time chat with SSE push
- [x] Chat history persistence (SQLite, 200 message cap)
- [x] Interactive question/confirm buttons in chat
- [x] Notification system (unread badge, amber banner, toasts, browser notifications)
- [x] Project filter in header (shared across all pages)
- [x] Focus indicator in header
- [x] Mobile-responsive layout (sticky top bar, pinned chat input)
- [x] Touch-action zoom prevention

## Project Management

- [x] Projects as first-class DB entities (CRUD)
- [x] Clone from GitHub URL
- [x] Create new project (git init + optional GitHub repo creation via `gh`)
- [x] Add existing directory
- [x] Discovered paths (agent CWDs not in projects table)
- [x] Auto-detect tmux sessions running Claude in project path
- [x] Git URL auto-population from remote
- [x] Launch agent from project page

## API (Hono)

- [x] GET/POST /projects, /projects/clone, /projects/init, /projects/discovered
- [x] GET/PATCH/DELETE /projects/:id
- [x] GET /agents, /agents/live, /agents/:id
- [x] GET /snapshots
- [x] GET /audit
- [x] GET/POST/DELETE /tmux, POST /tmux/launch
- [x] POST /chat, /chat/answer, /chat/confirm
- [x] GET /chat/events (SSE), /chat/focus, /chat/history
- [x] GET /recordings, POST /recordings/toggle, GET /recordings/:id/:ts

## Future Ideas

- [ ] Multi-channel Slack support (different channels per project)
- [ ] Alert thresholds (CPU > 90%, disk > 80%)
- [ ] Rate limiting for LLM summarization calls
- [ ] Summary diff detection (skip posting when content unchanged)
- [ ] Agent lifecycle commands in chat (kill, restart)
- [ ] Configurable watcher poll intervals
