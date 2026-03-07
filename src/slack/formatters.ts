import type { KnownBlock } from "@slack/types";
import type { SystemStatus } from "../monitors/system.js";
import type { ClaudeSession, SessionStatus } from "../monitors/claude.js";
import type { GitRepoStatus } from "../monitors/git.js";
import type { SessionSnapshot } from "../summarizer.js";
import type { TmuxSession } from "../actions/tmux.js";
import type { AuditEntry } from "../actions/audit.js";

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

const STATUS_EMOJI: Record<SessionStatus, string> = {
  executing: "\u{1F7E2}",
  waiting: "\u{1F7E1}",
  thinking: "\u{1F535}",
  idle: "\u26AA",
};

function formatToolCounts(toolCounts: Record<string, number>): string {
  return Object.entries(toolCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${name}\u00D7${count}`)
    .join(", ");
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function formatAgentList(
  sessions: ClaudeSession[],
  snapshots?: Map<string, SessionSnapshot>
): KnownBlock[] {
  if (sessions.length === 0) {
    return [header("Claude Agents"), section("No active sessions found (last 24h)")];
  }

  const blocks: KnownBlock[] = [header("Claude Agents")];

  for (const s of sessions.slice(0, 10)) {
    const age = formatAge(s.lastModified);
    const emoji = STATUS_EMOJI[s.status];
    const snapshot = snapshots?.get(s.id);

    const statusLine = `${s.status} | tmux: \`${s.tmuxSession}\` | pid: ${s.pid}`;

    let detail: string;
    if (s.status === "waiting" && s.waitingQuestion) {
      const questionLines = s.waitingQuestion.split("\n");
      const question = questionLines[0];
      const options = questionLines.length > 1 ? `\n${questionLines.slice(1).join("\n")}` : "";
      detail =
        `${emoji} \`${s.id}\` - ${s.projectPath} (${age} ago)\n` +
        `  ${statusLine}\n` +
        `  Question: _${question}_${options}`;
    } else {
      // Prefer AI summary over raw lastActivity
      const summaryText = snapshot?.summary || s.aiSummary;
      const summaryLine = summaryText
        ? `\n> ${summaryText.replace(/\n/g, " ")}`
        : (s.summary.lastActivity ? `\n> ${s.summary.lastActivity.replace(/\n/g, " ")}` : "");
      detail =
        `${emoji} \`${s.id}\` - ${s.projectPath} (${age} ago)\n` +
        `  ${statusLine}${summaryLine}`;

      // Flag if there's substantial content available
      if (snapshot?.substantialContent) {
        detail += `\n  _Has full output — use_ \`agent ${s.id}\` _to view_`;
      }
    }

    blocks.push(section(detail));
  }

  return blocks;
}

export function formatAgentDetail(
  session: ClaudeSession,
  snapshot?: SessionSnapshot | null,
  recentHistory?: SessionSnapshot[]
): KnownBlock[] {
  const age = formatAge(session.lastModified);
  const emoji = STATUS_EMOJI[session.status];

  const blocks: KnownBlock[] = [
    header(`${emoji} Agent ${session.id}`),
    section(
      `*Project:* ${session.projectPath}\n` +
        `*tmux:* \`${session.tmuxSession}\` | *pid:* ${session.pid}\n` +
        `*Status:* ${session.status}\n` +
        `*Last Active:* ${age} ago\n` +
        `*Messages:* ${session.messageCount}`
    ),
  ];

  // AI Summary at top
  const aiText = snapshot?.summary || session.aiSummary;
  if (aiText) {
    blocks.push(section(`*Summary:*\n> ${aiText.replace(/\n/g, " ")}`));
  }

  // Substantial content — full preserved output
  if (snapshot?.substantialContent) {
    blocks.push(divider());
    blocks.push(section(`*Agent Output:*\n${snapshot.substantialContent}`));
  }

  // Waiting question
  if (session.status === "waiting" && session.waitingQuestion) {
    blocks.push(
      section(`*Waiting for input:*\n> ${session.waitingQuestion.replace(/\n/g, "\n> ")}`)
    );
  }

  blocks.push(divider());

  // Mechanical summary
  const s = session.summary;
  const summaryParts: string[] = [];
  if (s.timespan) summaryParts.push(`*Timespan:* ${s.timespan}`);
  const toolStr = formatToolCounts(s.toolCounts);
  if (toolStr) summaryParts.push(`*Tools:* ${toolStr}`);
  if (s.totalOutputTokens > 0)
    summaryParts.push(`*Output Tokens:* ${formatTokens(s.totalOutputTokens)}`);
  if (s.filesEdited.length > 0)
    summaryParts.push(`*Files Touched:* ${s.filesEdited.map((f) => `\`${f}\``).join(", ")}`);
  if (summaryParts.length > 0) {
    blocks.push(section(summaryParts.join("\n")));
  }

  if (s.lastActivity) {
    blocks.push(section(`*Last Activity:*\n> ${s.lastActivity}`));
  }

  blocks.push(divider());
  blocks.push(section(`*Last User Message:*\n> ${session.lastUserMessage || "N/A"}`));
  blocks.push(
    section(`*Last Assistant Message:*\n> ${session.lastAssistantMessage || "N/A"}`)
  );

  if (session.pendingToolCalls.length > 0) {
    const toolLines = session.pendingToolCalls
      .map((t) => `\`${t.tool}\` - ${t.status}`)
      .join("\n");
    blocks.push(section(`*Tool Calls:*\n${toolLines}`));
  }

  // Recent history snapshots
  if (recentHistory && recentHistory.length > 0) {
    blocks.push(divider());
    blocks.push(section("*Recent History:*"));
    for (const snap of recentHistory.slice(-5)) {
      const ts = new Date(snap.timestamp);
      const timeStr = `${ts.toLocaleDateString()} ${ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
      blocks.push(
        section(`_${timeStr}_ (${snap.status})\n> ${snap.summary.replace(/\n/g, " ")}`)
      );
    }
  }

  return blocks;
}

export function formatHistory(snapshots: SessionSnapshot[]): KnownBlock[] {
  if (snapshots.length === 0) {
    return [header("History"), section("No snapshots recorded yet.")];
  }

  const blocks: KnownBlock[] = [header("History")];

  // Show most recent first, limit to 15
  const recent = snapshots.slice(-15).reverse();
  for (const snap of recent) {
    const ts = new Date(snap.timestamp);
    const timeStr = `${ts.toLocaleDateString()} ${ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    const emoji = STATUS_EMOJI[snap.status as SessionStatus] || "\u26AA";
    const tag = snap.substantialContent ? " [full output]" : "";
    blocks.push(
      section(
        `${emoji} \`${snap.sessionId}\` — _${timeStr}_ (${snap.status})${tag}\n> ${snap.summary.replace(/\n/g, " ")}`
      )
    );
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

export function formatTmuxSessionList(sessions: TmuxSession[]): KnownBlock[] {
  if (sessions.length === 0) {
    return [header("tmux Sessions"), section("No tmux sessions found.")];
  }

  const blocks: KnownBlock[] = [header("tmux Sessions")];

  for (const s of sessions) {
    const age = formatAge(s.created);
    const status = s.attached ? "attached" : "detached";
    blocks.push(
      section(
        `\`${s.name}\` — ${s.windows} window(s) | ${status} | created ${age} ago`
      )
    );
  }

  return blocks;
}

export function formatTmuxCapture(
  sessionName: string,
  content: string
): KnownBlock[] {
  return [
    header(`Capture: ${sessionName}`),
    section(`\`\`\`\n${content || "(empty)"}\n\`\`\``),
  ];
}

export function formatConfirmSend(
  sessionName: string,
  text: string,
  actionId: string
): KnownBlock[] {
  return [
    section(`*Confirm send to* \`${sessionName}\`:\n> ${text}`),
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Execute" },
          style: "danger",
          action_id: "confirm_send",
          value: JSON.stringify({ actionId, session: sessionName, text }),
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Cancel" },
          action_id: "cancel_send",
          value: JSON.stringify({ actionId, session: sessionName, text }),
        },
      ],
    } as KnownBlock,
  ];
}

export function formatAuditLog(entries: AuditEntry[]): KnownBlock[] {
  if (entries.length === 0) {
    return [header("Audit Log"), section("No actions recorded yet.")];
  }

  const blocks: KnownBlock[] = [header("Audit Log")];

  // Show most recent first
  for (const e of [...entries].reverse().slice(0, 15)) {
    const ts = new Date(e.timestamp);
    const timeStr = `${ts.toLocaleDateString()} ${ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    const icon = e.result === "success" ? "+" : "x";
    const userStr = e.slackUser ? ` (<@${e.slackUser}>)` : "";
    blocks.push(
      section(
        `\`[${icon}]\` _${timeStr}_ *${e.action}* -> \`${e.target}\`${userStr}\n> ${e.input.slice(0, 100)}${e.detail ? ` — ${e.detail.slice(0, 100)}` : ""}`
      )
    );
  }

  return blocks;
}
