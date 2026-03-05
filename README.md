# Orbit - Remote Machine Monitor via Slack

Monitor remote machines, Claude Code agents, and git activity from Slack.

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
6. Invite the bot to your channel: `/invite @Orbit`

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

Send these in the channel where Orbit is invited:

| Command | Description |
|---|---|
| `orbit status` | System health — CPU, memory, disk, uptime |
| `orbit agents` | List active Claude Code sessions (last 24h) |
| `orbit agent <id>` | Deep dive on a specific agent session |
| `orbit git` | Git status across all watched repos |
| `orbit git <repo>` | Detailed status for a specific repo |
| `orbit report` | Full combined report |
| `orbit watch <minutes>` | Start periodic reports |
| `orbit stop` | Stop periodic reporting |
| `orbit help` | Show available commands |

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
