# Orbit

**Remote machine agent, controllable via Slack.**

Orbit is a Node.js daemon you install on remote machines. It monitors Claude Code agents, system health, and git — and can act on the machine by sending commands to tmux sessions. All from Slack.

## Architecture

```
src/
  monitors/          # Read the system (status, agents, git)
  actions/           # Change the system (tmux send, audit)
  commands/router.ts # Parse Slack commands, dispatch to handlers
  slack/bot.ts       # Slack Bolt app, message + action handlers
  slack/formatters.ts# Block Kit message formatters
```

## Commands

### Monitoring

| Command | Description |
|---|---|
| `orbit status` | System health (CPU, memory, disk, uptime) |
| `orbit agents` | List active Claude Code sessions |
| `orbit agent <id>` | Detail on a specific agent |
| `orbit git` | Git status across watched repos |
| `orbit git <repo>` | Detailed status for a specific repo |
| `orbit report` | Full combined report |
| `orbit history` | Recent session snapshots (last 24h) |
| `orbit history <id>` | History for a specific session |
| `orbit watch <minutes>` | Start periodic reporting |
| `orbit stop` | Stop periodic reporting |

### Actions (Phase 1 — tmux)

| Command | Description | Confirmation? |
|---|---|---|
| `orbit sessions` | List all tmux sessions | No |
| `orbit capture <session>` | Show visible pane content | No |
| `orbit send <session> <text>` | Send keystrokes to session | If text doesn't match allowedCommands |
| `orbit answer <agent-id> <text>` | Answer a Claude agent's question | No |
| `orbit audit` | Show recent action audit log | No |

## Security Model

- **Channel-based auth:** Only messages in configured channels are processed
- **Allowlist:** `actions.allowedCommands` glob patterns control what skips confirmation
- **Confirmation buttons:** Non-allowlisted `send` commands show Execute/Cancel buttons
- **Audit log:** All actions logged to `~/.orbit/audit.jsonl` with user ID, timestamp, and result

## Config (`~/.orbit/config.yaml`)

```yaml
slack:
  appToken: xapp-...
  botToken: xoxb-...
  channel: C0123ORBIT

claude:
  sessionDirs:
    - /root/.claude/projects/

git:
  repos:
    - /root/orbit

actions:
  confirmDangerous: true
  captureDelayMs: 3000
  allowedCommands:
    - "y"
    - "yes"
    - "no"
    - "npm *"
    - "git *"

scheduler:
  enabled: false
  intervalMinutes: 30
```

## Roadmap

- [x] Project scaffold, config, Slack bot
- [x] System health monitor
- [x] Claude agent monitor with AI summaries
- [x] Git monitor
- [x] Scheduler and periodic reporting
- [x] Session history tracking
- [x] **Phase 1: tmux actions** — send/answer/capture/sessions, audit log, confirmation flow
- [ ] Phase 2: Process management (kill, restart)
- [ ] Phase 3: File operations (read, tail, edit)
- [ ] Phase 4: Shell exec (run arbitrary commands with confirmation)
