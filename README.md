# Orbit

Monitor and control Claude Code agents on remote machines. Orbit runs as a daemon, watching agent sessions in the background, posting updates to Slack (or a web chat), and letting you interact with agents directly — answer questions, approve tool calls, send commands, and launch new sessions.

## Features

- **Agent monitoring** — Discovers live Claude Code sessions via tmux, parses JSONL conversation logs, derives status (executing/thinking/waiting/idle)
- **Smart watcher** — Background polling (30s) for activity and status changes, plus focused post-command watches (5s) that report back after you send input
- **AI summaries** — Claude Haiku generates incremental session summaries with full conversation context
- **Interactive prompts** — AskUserQuestion prompts rendered as clickable buttons; pending tool calls (Bash/Write/Edit) get approve/deny buttons
- **Natural language** — Type naturally; Orbit routes to the right command or answers from context
- **Web dashboard** — React SPA with projects, agents, timeline, audit log, and real-time chat
- **Project management** — Register projects, clone repos, create new projects with GitHub integration
- **Notifications** — SSE push to web, browser notifications for waiting agents, toast popups
- **System & git monitoring** — CPU, memory, disk, uptime, git status across repos
- **Audit trail** — All actions logged to SQLite with timestamps and user attribution
- **Adapter abstraction** — Slack and CLI adapters share the same `MessagingAdapter` interface; web chat uses the same command router

## Architecture

```
src/
├── index.ts              # Entry point — starts adapter, watcher, scheduler, web server
├── adapter.ts            # MessagingAdapter interface
├── messages.ts           # Platform-agnostic message types (MessagePart, Message)
├── formatters.ts         # Message formatters (agent lists, reports, prompts, etc.)
├── config.ts             # YAML config loader (~/.orbit/config.yaml)
├── db.ts                 # SQLite database (WAL mode) — snapshots, agents, projects, chat, audit
├── summarizer.ts         # LLM-powered session summarization (Haiku)
├── scheduler.ts          # Periodic full-report scheduler
├── history.ts            # Re-export from db.ts for backwards compat
├── adapters/
│   ├── slack.ts          # Slack Bolt app (Socket Mode), Block Kit rendering, buttons
│   └── cli.ts            # CLI adapter (readline-based, for local testing)
├── api/
│   ├── index.ts          # Hono app — mounts all routes, serves web/dist
│   ├── agents.ts         # GET /agents, /agents/live, /agents/:id
│   ├── projects.ts       # CRUD /projects, /projects/clone, /projects/init, /projects/discovered
│   ├── chat.ts           # POST /chat, /chat/answer, /chat/confirm, GET /chat/events (SSE)
│   ├── tmux.ts           # GET/POST/DELETE /tmux, POST /tmux/launch
│   ├── snapshots.ts      # GET /snapshots
│   ├── audit.ts          # GET /audit
│   └── auth.ts           # Basic auth middleware
├── commands/
│   └── router.ts         # Command dispatch, NL interpretation via Haiku, help text
├── monitors/
│   ├── watcher.ts        # Background + active watches, confirm button injection
│   ├── claude.ts         # Claude session discovery, JSONL parsing, text extraction
│   ├── recorder.ts       # Opt-in watcher poll recording (~/.orbit/recordings/)
│   ├── system.ts         # System health (CPU, memory, disk)
│   └── git.ts            # Git repo status, clone, init, GitHub repo creation
└── actions/
    ├── tmux.ts           # tmux session management, pane capture, send keys, launch
    └── audit.ts          # Re-export from db.ts

web/src/
├── App.tsx               # React Router setup
├── api.ts                # API client (fetch wrappers)
├── notifications.tsx     # SSE subscriber, notification context, toasts, browser alerts
├── agentFilter.tsx       # Project filter context (shared across pages)
├── types.ts              # Shared TypeScript types
└── components/
    ├── Layout.tsx         # Shell — sidebar nav, mobile top bar, project selector
    ├── ProjectList.tsx    # Project cards, add/clone/create forms, discovered paths
    ├── ProjectDetail.tsx  # Project detail — agents, git status, tmux sessions
    ├── AgentList.tsx      # Agent list page
    ├── AgentDetail.tsx    # Agent detail — summary, output, history
    ├── Chat.tsx           # Real-time chat — commands, answers, confirms, SSE messages
    ├── Timeline.tsx       # Session snapshot timeline
    ├── AuditLog.tsx       # Action audit log viewer
    ├── LaunchDialog.tsx   # Launch new agent dialog
    ├── TmuxManager.tsx    # tmux session management
    ├── ConfirmDialog.tsx  # Reusable confirmation dialog
    ├── StatusBadge.tsx    # Agent status indicator
    └── Pagination.tsx     # Pagination controls
```

## Setup

### 1. Create a Slack App (optional — web chat works standalone)

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and create a new app
2. Enable **Socket Mode** — save the App-Level Token (`xapp-...`)
3. Add bot scopes: `chat:write`, `app_mentions:read`, `channels:history`, `channels:read`
4. Install to workspace — save the Bot Token (`xoxb-...`)
5. Subscribe to events: `message.channels`, `app_mention`
6. Enable **Interactivity** (needed for buttons)
7. Invite the bot to your channel: `/invite @Orbit`

### 2. Configure

```bash
mkdir -p ~/.orbit
cp config.example.yaml ~/.orbit/config.yaml
# Edit with your tokens and paths
```

### 3. Build & Run

```bash
npm install && cd web && npm install && cd ..
npm run build    # builds server (tsup) + web (vite)

# Production
node dist/index.js

# Development
npm run dev      # server with tsx
npm run dev:web  # vite dev server (separate terminal)

# CLI mode (no Slack)
node dist/index.js --cli
```

## Commands

Available via Slack, web chat, or CLI. Prefix with `orbit` or just type naturally.

### Monitoring

| Command | Description |
|---|---|
| `status` | System health — CPU, memory, disk, uptime |
| `agents` | List active Claude Code sessions with summaries |
| `agent <id>` | Deep dive on a specific agent session |
| `git` / `git <repo>` | Git status across repos |
| `report` | Full combined report |
| `history` / `history <id>` | Session snapshots |
| `watch <minutes>` / `stop` | Periodic reporting |

### Actions

| Command | Description |
|---|---|
| `sessions` | List tmux sessions |
| `capture <session>` | Show visible pane content |
| `send <session> <text>` | Send keystrokes to a session |
| `answer <id> <text>` | Answer a Claude agent's question |
| `focus <session>` / `unfocus` | Route all input to a session |
| `audit` | Action audit log |

### Debugging

| Command | Description |
|---|---|
| `record on\|off\|status` | Toggle watcher poll recording |
| `recordings` | List recorded sessions |

### Natural Language

Type naturally — Orbit uses Claude Haiku to interpret and route:

- "what's the agent doing?" → answers from session context
- "say yes to prism" → `answer <prism-agent-id> yes`
- "approve that" → finds the waiting agent, answers yes

## Web Dashboard

The web UI runs on the same port as the API (default 443 with TLS, or 3000). It provides:

- **Projects** — Register, clone from GitHub, or create new projects (with optional GitHub repo creation)
- **Agents** — Live agent list with status badges, grouped by project
- **Chat** — Real-time command interface with SSE push, interactive prompt buttons, focus mode
- **Timeline** — Session snapshot history
- **Audit Log** — All actions with timestamps

Notifications: amber banner when agents are waiting, browser notifications, toast popups, unread badge on Chat.

## Configuration

`~/.orbit/config.yaml`:

```yaml
slack:
  appToken: xapp-...
  botToken: xoxb-...
  channel: C0123456789

claude:
  sessionDirs:
    - /root/.claude/projects/

git:
  repos:
    - /path/to/repo

scheduler:
  enabled: false
  intervalMinutes: 30

actions:
  confirmDangerous: true
  captureDelayMs: 3000
  allowedCommands:
    - "y"
    - "yes"
    - "no"
    - "npm *"
    - "git *"
  watchMessageThreshold: 10
  watchActiveTimeoutMs: 60000

web:
  port: 443
  auth:
    username: admin
    password: changeme
  tls:
    cert: /path/to/cert.pem
    key: /path/to/key.pem

# anthropic:
#   apiKey: sk-ant-...  # Or set ANTHROPIC_API_KEY env var
```

## Data Storage

All data stored in `~/.orbit/orbit.db` (SQLite, WAL mode):

- **snapshots** — Session state over time (status, summary, tool counts)
- **agents** — Agent records with project path, tmux session, JSONL path
- **projects** — Registered projects with name, path, tmux sessions, git URL
- **chat_messages** — Web chat history (capped at 200, auto-pruned)
- **audit_entries** — Action audit log

Recordings (opt-in) stored under `~/.orbit/recordings/`.

## Running as a Service

```bash
sudo cp orbit.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now orbit
```
