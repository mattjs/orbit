# Orbit

**Remote machine monitor, controllable via Slack.**

Orbit is a lightweight Node.js daemon you install on remote machines to observe what's happening — Claude Code agent activity, system health, and git changes — all from a Slack channel.

## Problem

When you have Claude Code agents running on remote machines, you're blind to what they're doing unless you SSH in and dig through logs. You want a quick way to check in, get summaries, and be alerted — without leaving your chat.

## Solution

A TypeScript daemon that runs on the machine and connects to Slack via Socket Mode (no public URL needed). Send commands in Slack, get formatted reports back.

## Architecture

```
┌─────────┐       ┌──────────────────────────────┐
│  Slack   │◄─────►  Orbit Daemon (Node.js)       │
│  Channel │       │                               │
└─────────┘       │  ┌─────────────────────────┐  │
                  │  │ Command Router            │  │
                  │  └────────┬────────────────┘  │
                  │           │                    │
                  │  ┌────────┴────────────────┐  │
                  │  │ Monitors                 │  │
                  │  │  ├─ Claude Agent Monitor  │  │
                  │  │  ├─ System Health Monitor │  │
                  │  │  └─ Git Activity Monitor  │  │
                  │  └─────────────────────────┘  │
                  └──────────────────────────────┘
```

## Commands

| Command | Description |
|---|---|
| `orbit status` | Quick health check — uptime, CPU, memory, disk |
| `orbit agents` | List active Claude Code sessions and their current state |
| `orbit agent <id>` | Deep dive on a specific agent — recent actions, pending tools, token usage |
| `orbit git` | Summary of git activity across watched repos |
| `orbit git <repo>` | Detailed status for a specific repo |
| `orbit report` | Full combined report from all monitors |
| `orbit watch <interval>` | Start periodic reports to the channel |
| `orbit stop` | Stop periodic reporting |

## Monitors

### Claude Agent Monitor
- Discovers active Claude Code sessions from `~/.claude/projects/`
- Parses JSONL session logs to extract conversation state
- Surfaces pending tool calls, recent actions, token usage
- Shows what each agent is currently working on

### System Health Monitor
- CPU usage, load average
- Memory usage (used/total)
- Disk usage per mount
- Top processes by CPU/memory
- Uptime

### Git Activity Monitor
- Scans configured repos
- Current branch, ahead/behind status
- Recent commits (last N)
- Uncommitted changes summary
- Shows diffs on request

## Tech Stack

- **Runtime:** Node.js 20+ / TypeScript
- **Slack:** `@slack/bolt` (Socket Mode)
- **Git:** `simple-git`
- **Config:** YAML (`~/.orbit/config.yaml`)
- **Build:** `tsup`
- **Deploy:** systemd or pm2

## Config

```yaml
slack:
  appToken: xapp-...    # Socket Mode token
  botToken: xoxb-...    # Bot token
  channel: C0123ORBIT   # Default reporting channel

claude:
  sessionDirs:
    - /root/.claude/projects/

git:
  repos:
    - /root/orbit
    - /root/my-project

scheduler:
  enabled: false
  intervalMinutes: 30
```

## Setup

1. Create a Slack app at api.slack.com/apps
2. Enable Socket Mode, add `app_mentions:read`, `chat:write` scopes
3. Install to workspace, grab tokens
4. Install Orbit on the remote machine:
   ```bash
   npm install -g orbit-monitor
   orbit init   # creates ~/.orbit/config.yaml
   orbit start  # starts the daemon
   ```
5. Message `@Orbit status` in your Slack channel

## Task Checklist

- [ ] Project scaffold — `package.json`, `tsconfig.json`, `tsup.config.ts`, deps
- [ ] Config loader — Parse YAML, validate, defaults
- [ ] Slack bot setup — Bolt.js + Socket Mode, basic ping/pong
- [ ] Command router — Parse messages, dispatch to handlers
- [ ] System health monitor — CPU, mem, disk, uptime, processes
- [ ] Claude agent monitor — Session discovery, JSONL parsing, state extraction
- [ ] Git monitor — Repo status, commits, branches, changes
- [ ] Slack formatters — Block Kit messages for each report type
- [ ] Scheduler — Periodic auto-reporting on interval
- [ ] CLI entry point — `orbit start`, `orbit init` commands
- [ ] Example config + README — Setup docs, Slack app creation guide
- [ ] Install script / systemd unit — Easy remote deployment
