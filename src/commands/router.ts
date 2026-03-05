import type { KnownBlock } from "@slack/types";
import type { Config } from "../config.js";
import { getSystemStatus } from "../monitors/system.js";
import { getClaudeSessions, getClaudeSession } from "../monitors/claude.js";
import { getGitStatus, getGitRepoStatus } from "../monitors/git.js";
import {
  formatSystemStatus,
  formatAgentList,
  formatAgentDetail,
  formatGitSummary,
  formatGitDetail,
  formatFullReport,
} from "../slack/formatters.js";
import { startScheduler, stopScheduler } from "../scheduler.js";

interface CommandResult {
  blocks: KnownBlock[];
  text: string;
}

type PostMessage = (channel: string, blocks: KnownBlock[], text: string) => Promise<void>;

export function createRouter(config: Config, postMessage: PostMessage) {
  return async function handleCommand(
    text: string,
    channel: string
  ): Promise<CommandResult> {
    const parts = text.trim().split(/\s+/);
    const command = parts[0]?.toLowerCase();
    const arg = parts.slice(1).join(" ");

    switch (command) {
      case "status":
        return handleStatus();
      case "agents":
        return handleAgents();
      case "agent":
        return handleAgent(arg);
      case "git":
        return arg ? handleGitRepo(arg) : handleGit();
      case "report":
        return handleReport();
      case "watch":
        return handleWatch(arg, channel, postMessage);
      case "stop":
        return handleStop();
      case "help":
        return handleHelp();
      default:
        return handleHelp();
    }
  };

  function handleStatus(): CommandResult {
    const status = getSystemStatus();
    return {
      blocks: formatSystemStatus(status),
      text: `System status for ${status.hostname}`,
    };
  }

  function handleAgents(): CommandResult {
    const sessions = getClaudeSessions(config.claude.sessionDirs);
    return {
      blocks: formatAgentList(sessions),
      text: `Found ${sessions.length} active Claude sessions`,
    };
  }

  function handleAgent(id: string): CommandResult {
    if (!id) {
      return {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Usage: `orbit agent <id>`" } }],
        text: "Missing agent ID",
      };
    }
    const session = getClaudeSession(config.claude.sessionDirs, id);
    if (!session) {
      return {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: `No session found with ID \`${id}\`` } }],
        text: "Session not found",
      };
    }
    return {
      blocks: formatAgentDetail(session),
      text: `Agent ${session.id} detail`,
    };
  }

  async function handleGit(): Promise<CommandResult> {
    const repos = await getGitStatus(config.git.repos);
    return {
      blocks: formatGitSummary(repos),
      text: `Git status for ${repos.length} repos`,
    };
  }

  async function handleGitRepo(name: string): Promise<CommandResult> {
    const repo = await getGitRepoStatus(config.git.repos, name);
    if (!repo) {
      return {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: `No repo found matching \`${name}\`` } }],
        text: "Repo not found",
      };
    }
    return {
      blocks: formatGitDetail(repo),
      text: `Git detail for ${repo.name}`,
    };
  }

  async function handleReport(): Promise<CommandResult> {
    const system = getSystemStatus();
    const sessions = getClaudeSessions(config.claude.sessionDirs);
    const repos = await getGitStatus(config.git.repos);
    return {
      blocks: formatFullReport(system, sessions, repos),
      text: "Full orbit report",
    };
  }

  function handleWatch(
    arg: string,
    channel: string,
    post: PostMessage
  ): CommandResult {
    const minutes = parseInt(arg, 10);
    if (isNaN(minutes) || minutes < 1) {
      return {
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "Usage: `orbit watch <minutes>`" } }],
        text: "Invalid interval",
      };
    }

    startScheduler(minutes, channel, config, post);

    return {
      blocks: [{ type: "section", text: { type: "mrkdwn", text: `Started periodic reports every ${minutes} minute(s). Use \`orbit stop\` to cancel.` } }],
      text: `Watching every ${minutes} minutes`,
    };
  }

  function handleStop(): CommandResult {
    stopScheduler();
    return {
      blocks: [{ type: "section", text: { type: "mrkdwn", text: "Periodic reporting stopped." } }],
      text: "Stopped watching",
    };
  }

  function handleHelp(): CommandResult {
    const helpText = [
      "*Orbit Commands:*",
      "`orbit status` — System health (CPU, memory, disk, uptime)",
      "`orbit agents` — List active Claude Code sessions",
      "`orbit agent <id>` — Detail on a specific agent session",
      "`orbit git` — Git status across all watched repos",
      "`orbit git <repo>` — Detailed status for a specific repo",
      "`orbit report` — Full combined report",
      "`orbit watch <minutes>` — Start periodic reporting",
      "`orbit stop` — Stop periodic reporting",
      "`orbit help` — Show this help",
    ].join("\n");

    return {
      blocks: [{ type: "section", text: { type: "mrkdwn", text: helpText } }],
      text: "Orbit help",
    };
  }
}
