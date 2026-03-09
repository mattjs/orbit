# Orbit - Remote Machine Monitor via Slack

Monitor remote machines, Claude Code agents, and git activity from Slack. Orbit watches your agents in the background and keeps you informed — posting updates when meaningful work happens, alerting on questions that need answers, and letting you interact with agents directly from Slack.

## Features

- **Agent monitoring** — Discovers live Claude Code sessions via tmux, parses JSONL conversation logs, derives status (executing/thinking/waiting/idle)
- **Smart background watcher** — Two-mode watching: periodic updates after N messages of activity, plus focused post-command watches that report back after you send input
- **AI-powered summaries** — Uses Claude Haiku to generate incremental session summaries with full conversation context
- **Interactive commands** — Send keystrokes to agents, answer questions, confirm dangerous actions via Slack buttons
- **Natural language interface** — Just type naturally; Orbit routes to the right command or answers from context
- **System & git monitoring** — CPU, memory, disk, uptime, plus git status across repos
- **Audit trail** — All actions logged with timestamps and Slack user attribution
- **History** — Session snapshots persisted to `~/.orbit/history.jsonl`

## Architecture

```
src/
├── index.ts                  # Entry point — starts bot, scheduler, watcher
├── config.ts                 # YAML config loader (~/.orbit/config.yaml)
├── summarizer.ts             # LLM-powered session summarization (Haiku)
├── scheduler.ts              # Periodic full-report scheduler
├── history.ts                # Snapshot persistence (history.jsonl)
├── commands/
│   └── router.ts             # Command dispatch, NL interpretation, send/answer
├── monitors/
│   ├── watcher.ts            # Background agent watcher (periodic + active watches)
│   ├── claude.ts             # Claude session discovery & JSONL parsing
│   ├── system.ts             # System health (CPU, memory, disk)
│   └── git.ts                # Git repo status
├── slack/
│   ├── bot.ts                # Slack Bolt app (Socket Mode), action handlers
│   └── formatters.ts         # Slack Block Kit message formatting
└── actions/
    ├── tmux.ts               # tmux session listing, pane capture, send keys
    └── audit.ts              # Action audit log
```

## Setup

### 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and create a new app
2. Enable **Socket Mode** under Settings > Socket Mode — save the App-Level Token (`xapp-...`)
3. Under **OAuth & Permissions**, add these bot scopes:
   - `chat:write`
   - `app_mentions:read`
   - `channels:history`
   - `channels:read`
4. Install the app to your workspace — save the Bot Token (`xoxb-...`)
5. Under **Event Subscriptions**, subscribe to:
   - `message.channels`
   - `app_mention`
6. Under **Interactivity & Shortcuts**, ensure interactivity is enabled (needed for button actions)
7. Invite the bot to your channel: `/invite @Orbit`

### 2. Configure Orbit

```bash
mkdir -p ~/.orbit
cp config.example.yaml ~/.orbit/config.yaml
# Edit with your tokens and paths
```

### 3. Run

```bash
# Development
npm run dev

# Production
npm run build
node dist/index.js

# Or with a custom config path
node dist/index.js /path/to/config.yaml
```

## Commands

Send these in the channel where Orbit is invited (prefix with `orbit` or just type naturally):

### Monitoring

| Command | Description |
|---|---|
| `orbit status` | System health — CPU, memory, disk, uptime |
| `orbit agents` | List active Claude Code sessions with AI summaries |
| `orbit agent <id>` | Deep dive on a specific agent session |
| `orbit git` | Git status across all watched repos |
| `orbit git <repo>` | Detailed status for a specific repo |
| `orbit report` | Full combined report (system + agents + git) |
| `orbit history` | Recent session snapshots (last 24h) |
| `orbit history <id>` | History for a specific session |
| `orbit watch <minutes>` | Start periodic full reports |
| `orbit stop` | Stop periodic reporting |

### Actions

| Command | Description |
|---|---|
| `orbit sessions` | List all tmux sessions |
| `orbit capture <session>` | Show visible pane content from a tmux session |
| `orbit send <session> <text>` | Send keystrokes to a tmux session |
| `orbit answer <agent-id> <text>` | Answer a Claude agent's question |
| `orbit focus <session>` | Set focused session (commands route here by default) |
| `orbit unfocus` | Clear focused session |
| `orbit audit` | Show recent action audit log |
| `orbit help` | Show available commands |

### Natural Language

Just type naturally — Orbit uses Claude Haiku to interpret your message and route to the right command or answer from context:

- "what's the agent doing?" → answers from cached session state
- "say yes to prism" → routes to `answer <prism-agent-id> yes`
- "approve that" → finds the waiting agent, answers yes

## Background Agent Watcher

The watcher runs automatically and posts to Slack based on two modes:

### Periodic Activity Updates

Polls every 30s. Posts when:
- **Message count delta** reaches the threshold (default 10 messages) — you get an update roughly every 10 messages of active work
- **Status transitions** — e.g., executing → idle, thinking → waiting
- **New waiting questions** — immediate notification when an agent needs input

First-seen sessions are recorded silently (no startup dump).

### Post-Command Watches

When you send a command via `answer`, `send`, or confirm a dangerous action:
1. An active watch starts for that session (polls every 5s)
2. Waits for the agent to process and produce new output
3. Once message count stabilizes (same for 2 consecutive polls), posts a summary
4. Auto-expires after 60s to prevent leaks

This gives the "I sent it a command, what happened?" feedback loop.

## Configuration

`~/.orbit/config.yaml`:

```yaml
slack:
  appToken: xapp-...          # Socket Mode app token
  botToken: xoxb-...          # Bot OAuth token
  channel: C0123456789        # Channel ID to listen in

claude:
  sessionDirs:
    - /root/.claude/projects/  # Where Claude stores session JSONL files

git:
  repos:
    - /path/to/repo1
    - /path/to/repo2

scheduler:
  enabled: false
  intervalMinutes: 30

actions:
  confirmDangerous: true          # Show confirm button for non-allowlisted sends
  captureDelayMs: 3000            # Delay before capturing pane after send
  allowedCommands:                # Patterns that skip confirmation
    - "y"
    - "yes"
    - "no"
    - "npm *"
    - "git *"
  watchMessageThreshold: 10       # Post periodic update after this many new messages
  watchActiveTimeoutMs: 60000     # Max time for post-command watch (ms)

# anthropic:
#   apiKey: sk-ant-...  # Or set ANTHROPIC_API_KEY env var
```

## Running as a Service

### systemd

```bash
sudo cp orbit.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now orbit
```

### pm2

```bash
npm run build
pm2 start dist/index.js --name orbit
pm2 save
```
