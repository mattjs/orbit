import type { KnownBlock } from "@slack/types";
import type { SystemStatus } from "../monitors/system.js";
import type { ClaudeSession } from "../monitors/claude.js";
import type { GitRepoStatus } from "../monitors/git.js";

function section(text: string): KnownBlock {
  return { type: "section", text: { type: "mrkdwn", text } };
}

function divider(): KnownBlock {
  return { type: "divider" };
}

function header(text: string): KnownBlock {
  return { type: "header", text: { type: "plain_text", text } };
}

export function formatSystemStatus(status: SystemStatus): KnownBlock[] {
  const memBar = statusBar(status.memory.usedPercent);

  const blocks: KnownBlock[] = [
    header("System Status"),
    section(
      `*Host:* ${status.hostname} (${status.platform})\n` +
        `*Uptime:* ${status.uptime}\n` +
        `*CPU:* ${status.cpu.cores} cores | Load: ${status.cpu.loadAvg.join(", ")}\n` +
        `*Memory:* ${status.memory.used} / ${status.memory.total} (${status.memory.usedPercent}%) ${memBar}`
    ),
  ];

  if (status.disk.length > 0) {
    const diskLines = status.disk
      .map(
        (d) =>
          `\`${d.mount}\` ${d.used}/${d.size} (${d.usedPercent})`
      )
      .join("\n");
    blocks.push(section(`*Disk:*\n${diskLines}`));
  }

  if (status.topProcesses.length > 0) {
    const procLines = status.topProcesses
      .slice(0, 5)
      .map((p) => `\`${p.pid}\` CPU:${p.cpu} MEM:${p.mem} ${p.command}`)
      .join("\n");
    blocks.push(section(`*Top Processes:*\n${procLines}`));
  }

  return blocks;
}

export function formatAgentList(sessions: ClaudeSession[]): KnownBlock[] {
  if (sessions.length === 0) {
    return [header("Claude Agents"), section("No active sessions found (last 24h)")];
  }

  const blocks: KnownBlock[] = [header("Claude Agents")];

  for (const s of sessions.slice(0, 10)) {
    const age = formatAge(s.lastModified);
    const tools = s.recentActions.length > 0 ? s.recentActions.join(", ") : "none";
    const pending = s.pendingToolCalls.filter((t) => t.status === "pending");
    const pendingStr =
      pending.length > 0
        ? ` | *Pending:* ${pending.map((t) => t.tool).join(", ")}`
        : "";

    blocks.push(
      section(
        `*\`${s.id}\`* - ${s.projectPath} (${age} ago)\n` +
          `Messages: ${s.messageCount} | Tools: ${tools}${pendingStr}\n` +
          `> _${s.lastUserMessage || "no user message"}_`
      )
    );
  }

  return blocks;
}

export function formatAgentDetail(session: ClaudeSession): KnownBlock[] {
  const age = formatAge(session.lastModified);

  const blocks: KnownBlock[] = [
    header(`Agent ${session.id}`),
    section(
      `*Project:* ${session.projectPath}\n` +
        `*Last Active:* ${age} ago\n` +
        `*Messages:* ${session.messageCount}`
    ),
    divider(),
    section(`*Last User Message:*\n> ${session.lastUserMessage || "N/A"}`),
    section(
      `*Last Assistant Message:*\n> ${session.lastAssistantMessage || "N/A"}`
    ),
  ];

  if (session.recentActions.length > 0) {
    blocks.push(
      section(`*Recent Tools Used:*\n${session.recentActions.join(", ")}`)
    );
  }

  if (session.pendingToolCalls.length > 0) {
    const toolLines = session.pendingToolCalls
      .map((t) => `\`${t.tool}\` - ${t.status}`)
      .join("\n");
    blocks.push(section(`*Tool Calls:*\n${toolLines}`));
  }

  return blocks;
}

export function formatGitSummary(repos: GitRepoStatus[]): KnownBlock[] {
  if (repos.length === 0) {
    return [header("Git Status"), section("No repositories configured")];
  }

  const blocks: KnownBlock[] = [header("Git Status")];

  for (const repo of repos) {
    if (repo.error) {
      blocks.push(section(`*${repo.name}* - :warning: ${repo.error}`));
      continue;
    }

    const statusParts: string[] = [];
    if (repo.uncommittedChanges > 0)
      statusParts.push(`${repo.uncommittedChanges} changed`);
    if (repo.untrackedFiles > 0)
      statusParts.push(`${repo.untrackedFiles} untracked`);
    if (repo.ahead > 0) statusParts.push(`${repo.ahead} ahead`);
    if (repo.behind > 0) statusParts.push(`${repo.behind} behind`);

    const statusStr =
      statusParts.length > 0 ? statusParts.join(" | ") : "clean";

    blocks.push(
      section(
        `*${repo.name}* (\`${repo.branch}\`) - ${statusStr}`
      )
    );
  }

  return blocks;
}

export function formatGitDetail(repo: GitRepoStatus): KnownBlock[] {
  const blocks: KnownBlock[] = [header(`Git: ${repo.name}`)];

  if (repo.error) {
    blocks.push(section(`:warning: ${repo.error}`));
    return blocks;
  }

  blocks.push(
    section(
      `*Branch:* \`${repo.branch}\`\n` +
        `*Path:* ${repo.path}\n` +
        `*Ahead/Behind:* ${repo.ahead}/${repo.behind}\n` +
        `*Uncommitted:* ${repo.uncommittedChanges} | *Untracked:* ${repo.untrackedFiles}`
    )
  );

  if (repo.recentCommits.length > 0) {
    blocks.push(divider());
    const commitLines = repo.recentCommits
      .map((c) => `\`${c.hash}\` ${c.message} — _${c.author}_`)
      .join("\n");
    blocks.push(section(`*Recent Commits:*\n${commitLines}`));
  }

  return blocks;
}

export function formatFullReport(
  system: SystemStatus,
  sessions: ClaudeSession[],
  repos: GitRepoStatus[]
): KnownBlock[] {
  return [
    ...formatSystemStatus(system),
    divider(),
    ...formatAgentList(sessions),
    divider(),
    ...formatGitSummary(repos),
  ];
}

function formatAge(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function statusBar(percent: number): string {
  const filled = Math.round(percent / 10);
  const empty = 10 - filled;
  return `[${"█".repeat(filled)}${"░".repeat(empty)}]`;
}
