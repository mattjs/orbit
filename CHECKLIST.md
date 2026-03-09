# Orbit Development Checklist

## Core Infrastructure

- [x] Slack bot via Bolt SDK (Socket Mode)
- [x] YAML config loader (`~/.orbit/config.yaml`)
- [x] systemd service unit
- [x] tsup build pipeline

## Monitoring

- [x] System health (CPU, memory, disk, uptime)
- [x] Claude Code session discovery via tmux + `/proc`
- [x] JSONL conversation log parsing (messages, tool calls, status)
- [x] Session status derivation (executing, thinking, waiting, idle)
- [x] Waiting question extraction (AskUserQuestion with options)
- [x] Git repo status monitoring (branch, ahead/behind, dirty files)
- [x] AI-powered session summaries via Claude Haiku (incremental, context-preserving)
- [x] Session snapshot history (`~/.orbit/history.jsonl`)

## Background Agent Watcher

- [x] 30s background poll for all sessions
- [x] Message count delta threshold for periodic posts (default 10)
- [x] Status transition detection and posting
- [x] Waiting question immediate notification
- [x] First-seen sessions recorded silently (no startup dump)
- [x] Post-command active watches (5s poll, stabilization detection)
- [x] Active watch auto-expiry (60s timeout)
- [x] Active watches skip background poll (no duplicate posts)
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
- [x] `help` — command reference

## Actions & Safety

- [x] Dangerous command confirmation via Slack buttons (confirm/cancel)
- [x] Allowlist patterns for auto-approved commands
- [x] tmux pane capture with diff detection (before/after send)
- [x] Stable output polling (waitForStableOutput)
- [x] Audit trail with timestamps, user attribution, input/output

## Natural Language Interface

- [x] Claude Haiku-powered NL interpretation
- [x] System context injection (agents, status, tmux sessions)
- [x] Session focus awareness ("say yes" routes to focused session)
- [x] Direct answers from context vs. command routing
- [x] Conversation threading (replies respect thread context)

## Slack UX

- [x] Block Kit formatted messages (sections, headers, context, dividers)
- [x] Status emoji indicators (executing/thinking/waiting/idle)
- [x] Confirm/cancel buttons for dangerous sends
- [x] Agent summary sections with tool counts, files, tokens
- [x] Substantial content preservation (long-form agent output)

### Interactive Agent Prompts

When an agent enters the waiting state with an `AskUserQuestion`, post an interactive Slack message with buttons instead of plain text:

- [x] **Structured prompt parsing** — `WaitingPrompt` type in `claude.ts` with `question` and `options[]`, carried through `ClaudeSession` → `SessionSnapshot` → watcher/formatters.
- [x] **Yes/No prompts** — When no explicit options, defaults to yes/no buttons. "Yes" styled primary (green), "No" styled danger (red).
- [x] **Multiple choice prompts** — Options from `AskUserQuestion` rendered as individual buttons (up to 5). Clicking sends the option text to the agent's tmux session.
- [x] **Summary context** — Waiting notifications include the AI summary of what the agent was doing above the question, so the user has context when deciding.
- [x] **Watcher integration** — Clicking any answer button sends to tmux, audits, and triggers `startActiveWatch` for follow-up.
- [x] **All surfaces** — Buttons appear in background watcher notifications, post-command watch results, `agents` list, and `agent <id>` detail views.
- [ ] **Free-text fallback** — When no options detected, add a text input action for custom answers (currently defaults to yes/no buttons; free-text requires `answer <id> <text>` command).
- [ ] **Button state management** — After a button is clicked, update the original message to show which option was selected (disable other buttons or replace with confirmation text).

### Conversation Threading

- [x] Per-agent thread tracking (`agentThreads` map: agentId → threadTs)
- [x] Watcher periodic updates threaded under agent's parent message
- [x] Waiting prompts break out to top-level (needs attention), start new thread
- [x] Active watch follow-ups posted in the thread of the triggering message (button click) or agent thread
- [x] User commands in main channel → top-level reply; in a thread → reply in that thread
- [x] Button click replies (confirm, cancel, answer_prompt) threaded under the button's message
- [ ] Thread expiry — stale agent threads could accumulate (low priority, Slack handles gracefully)

## Agent Lifecycle Management

Manage Claude Code agents (tmux + `claude` CLI processes) from Slack.

### Start agents
- [ ] `orbit launch <project-path> [prompt]` — Create a new tmux session, `cd` to the project, run `claude` with an optional initial prompt
- [ ] Project directory allowlist in config (`lifecycle.allowedProjects`) — prevent launching in arbitrary paths
- [ ] Configurable default launch command (e.g., `claude`, `claude --resume`, `claude -p "..."`)
- [ ] Naming: auto-generate tmux session name from project dirname or allow `orbit launch --name <name> <path>`

### Stop agents
- [ ] `orbit kill <agent-id>` — Send SIGINT to the Claude process, then SIGTERM after timeout
- [ ] `orbit kill <agent-id> --force` — Immediately SIGKILL + destroy tmux session
- [ ] Confirmation required (reuse existing confirm button pattern)
- [ ] Graceful shutdown: try sending `/exit` or Ctrl-C first, escalate to signals

### Restart agents
- [ ] `orbit restart <agent-id>` — Kill + relaunch in the same tmux session and project directory
- [ ] Option to resume (`--resume`) or start fresh

### Safety
- [ ] Config: `lifecycle.enabled: false` (opt-in, disabled by default)
- [ ] Config: `lifecycle.allowedUsers` — Slack user IDs permitted to start/stop agents
- [ ] All lifecycle actions audited
- [ ] Rate limiting — prevent rapid start/stop cycles

### Design questions to resolve
- Should `launch` accept a full prompt inline, or should you `launch` then `send` the prompt separately?
- Should there be a max concurrent agents limit?
- Should `kill` also clean up the tmux session, or leave it for inspection?

## Future Ideas

- [ ] Multi-channel support (different channels for different agents/projects)
- [ ] Slash commands (`/orbit status`) as alternative to message-based commands
- [ ] Alert thresholds (notify when CPU > 90%, disk > 80%, etc.)
- [ ] Session grouping by project
- [ ] Web dashboard / web app
- [ ] Rate limiting for LLM summarization calls
- [ ] Summary diff detection (avoid posting when summary content hasn't meaningfully changed)
