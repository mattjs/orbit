import type { MessagePart, Message } from "./messages.js";
import type { SystemStatus } from "./monitors/system.js";
import type { ClaudeSession, SessionStatus, WaitingPrompt } from "./monitors/claude.js";
import type { GitRepoStatus } from "./monitors/git.js";
import type { SessionSnapshot } from "./summarizer.js";
import type { TmuxSession } from "./actions/tmux.js";
import type { AuditEntry } from "./actions/audit.js";

function text(t: string): MessagePart {
  return { kind: "text", text: t };
}

function headerPart(t: string): MessagePart {
  return { kind: "header", text: t };
}

function divider(): MessagePart {
  return { kind: "divider" };
}

/**
 * Parse a markdown string into structured MessageParts.
 * Splits on fenced code blocks (``` ... ```) → code parts,
 * and remaining prose → text parts (split at section headers or length).
 */
export function parseMarkdownMessage(md: string): Message {
  const parts: MessagePart[] = [];
  // Split on fenced code blocks: ```lang\n...\n```
  const segments = md.split(/(```[\s\S]*?```)/g);

  for (const seg of segments) {
    const trimmed = seg.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("```") && trimmed.endsWith("```")) {
      // Code block — extract label from optional language tag
      const firstNewline = trimmed.indexOf("\n");
      const label = firstNewline > 3 ? trimmed.slice(3, firstNewline).trim() : undefined;
      const code = firstNewline > 0
        ? trimmed.slice(firstNewline + 1, trimmed.length - 3).trimEnd()
        : trimmed.slice(3, trimmed.length - 3).trim();
      if (code) {
        parts.push({ kind: "code", text: code, label: label || undefined });
      }
    } else {
      // Prose — split on markdown headers (## ...) to keep sections manageable
      const sections = trimmed.split(/^(?=#{1,3} )/m);
      for (const section of sections) {
        const s = section.trim();
        if (!s) continue;
        // If a section starts with # header, extract it
        const headerMatch = s.match(/^(#{1,3})\s+(.+?)(?:\n|$)/);
        if (headerMatch) {
          parts.push(headerPart(headerMatch[2]));
          const rest = s.slice(headerMatch[0].length).trim();
          if (rest) parts.push(text(rest));
        } else {
          parts.push(text(s));
        }
      }
    }
  }

  return { parts };
}

function msg(...parts: MessagePart[]): Message {
  return { parts };
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

export function formatSystemStatus(status: SystemStatus): Message {
  const memBar = statusBar(status.memory.usedPercent);

  const parts: MessagePart[] = [
    headerPart("System Status"),
    text(
      `**Host:** ${status.hostname} (${status.platform})\n` +
        `**Uptime:** ${status.uptime}\n` +
        `**CPU:** ${status.cpu.cores} cores | Load: ${status.cpu.loadAvg.join(", ")}\n` +
        `**Memory:** ${status.memory.used} / ${status.memory.total} (${status.memory.usedPercent}%) ${memBar}`
    ),
  ];

  if (status.disk.length > 0) {
    const diskLines = status.disk
      .map(
        (d) =>
          `\`${d.mount}\` ${d.used}/${d.size} (${d.usedPercent})`
      )
      .join("\n");
    parts.push(text(`**Disk:**\n${diskLines}`));
  }

  if (status.topProcesses.length > 0) {
    const procLines = status.topProcesses
      .slice(0, 5)
      .map((p) => `\`${p.pid}\` CPU:${p.cpu} MEM:${p.mem} ${p.command}`)
      .join("\n");
    parts.push(text(`**Top Processes:**\n${procLines}`));
  }

  return msg(...parts);
}

export function formatAgentList(
  sessions: ClaudeSession[],
  snapshots?: Map<string, SessionSnapshot>
): Message {
  if (sessions.length === 0) {
    return msg(headerPart("Claude Agents"), text("No active sessions found (last 24h)"));
  }

  const parts: MessagePart[] = [headerPart("Claude Agents")];

  for (const s of sessions.slice(0, 10)) {
    const age = formatAge(s.lastModified);
    const emoji = STATUS_EMOJI[s.status];
    const snapshot = snapshots?.get(s.id);

    const statusLine = `${s.status} | tmux: \`${s.tmuxSession}\` | pid: ${s.pid}`;

    let detail: string;
    if (s.status === "waiting" && s.waitingPrompt) {
      detail =
        `${emoji} \`${s.id}\` - ${s.projectPath} (${age} ago)\n` +
        `  ${statusLine}`;
      const summaryText = snapshot?.summary || s.aiSummary;
      if (summaryText) {
        detail += `\n> ${summaryText.replace(/\n/g, " ")}`;
      }
      detail += `\n  **Needs input:** _${s.waitingPrompt.question.split("\n")[0].slice(0, 200)}_`;
      parts.push(text(detail));
      parts.push({
        kind: "question",
        id: s.id,
        tmuxSession: s.tmuxSession,
        question: s.waitingPrompt.question,
        options: s.waitingPrompt.options.length > 0 ? s.waitingPrompt.options : ["yes", "no"],
      });
      continue;
    } else if (s.status === "waiting" && s.waitingQuestion) {
      detail =
        `${emoji} \`${s.id}\` - ${s.projectPath} (${age} ago)\n` +
        `  ${statusLine}\n` +
        `  Question: _${s.waitingQuestion.split("\n")[0]}_`;
    } else {
      const summaryText = snapshot?.summary || s.aiSummary;
      const summaryLine = summaryText
        ? `\n> ${summaryText.replace(/\n/g, " ")}`
        : (s.summary.lastActivity ? `\n> ${s.summary.lastActivity.replace(/\n/g, " ")}` : "");
      detail =
        `${emoji} \`${s.id}\` - ${s.projectPath} (${age} ago)\n` +
        `  ${statusLine}${summaryLine}`;

      if (snapshot?.substantialContent) {
        detail += `\n  _Has full output — use_ \`agent ${s.id}\` _to view_`;
      }
    }

    parts.push(text(detail));
  }

  return msg(...parts);
}

export function formatAgentDetail(
  session: ClaudeSession,
  snapshot?: SessionSnapshot | null,
  recentHistory?: SessionSnapshot[]
): Message {
  const age = formatAge(session.lastModified);
  const emoji = STATUS_EMOJI[session.status];

  const parts: MessagePart[] = [
    headerPart(`${emoji} Agent ${session.id}`),
    text(
      `**Project:** ${session.projectPath}\n` +
        `**tmux:** \`${session.tmuxSession}\` | **pid:** ${session.pid}\n` +
        `**Status:** ${session.status}\n` +
        `**Last Active:** ${age} ago\n` +
        `**Messages:** ${session.messageCount}`
    ),
  ];

  const aiText = snapshot?.summary || session.aiSummary;
  if (aiText) {
    parts.push(text(`**Summary:**\n> ${aiText.replace(/\n/g, " ")}`));
  }

  if (snapshot?.substantialContent) {
    parts.push(divider());
    parts.push(headerPart("Agent Output"));
    const parsed = parseMarkdownMessage(snapshot.substantialContent);
    parts.push(...parsed.parts);
  }

  if (session.status === "waiting" && session.waitingPrompt) {
    parts.push(text(
      `**Waiting for input:**\n> ${session.waitingPrompt.question.split("\n").map(l => l.slice(0, 300)).join("\n> ")}`
    ));
    parts.push({
      kind: "question",
      id: session.id,
      tmuxSession: session.tmuxSession,
      question: session.waitingPrompt.question,
      options: session.waitingPrompt.options.length > 0 ? session.waitingPrompt.options : ["yes", "no"],
    });
  } else if (session.status === "waiting" && session.waitingQuestion) {
    parts.push(
      text(`**Waiting for input:**\n> ${session.waitingQuestion.replace(/\n/g, "\n> ")}`)
    );
  }

  parts.push(divider());

  const s = session.summary;
  const summaryParts: string[] = [];
  if (s.timespan) summaryParts.push(`**Timespan:** ${s.timespan}`);
  const toolStr = formatToolCounts(s.toolCounts);
  if (toolStr) summaryParts.push(`**Tools:** ${toolStr}`);
  if (s.totalOutputTokens > 0)
    summaryParts.push(`**Output Tokens:** ${formatTokens(s.totalOutputTokens)}`);
  if (s.filesEdited.length > 0)
    summaryParts.push(`**Files Touched:** ${s.filesEdited.map((f) => `\`${f}\``).join(", ")}`);
  if (summaryParts.length > 0) {
    parts.push(text(summaryParts.join("\n")));
  }

  if (s.lastActivity) {
    parts.push(text(`**Last Activity:**\n> ${s.lastActivity}`));
  }

  parts.push(divider());
  parts.push(text(`**Last User Message:**\n> ${session.lastUserMessage || "N/A"}`));
  parts.push(
    text(`**Last Assistant Message:**\n> ${session.lastAssistantMessage || "N/A"}`)
  );

  if (session.pendingToolCalls.length > 0) {
    const toolLines = session.pendingToolCalls
      .map((t) => `\`${t.tool}\` - ${t.status}`)
      .join("\n");
    parts.push(text(`**Tool Calls:**\n${toolLines}`));
  }

  if (recentHistory && recentHistory.length > 0) {
    parts.push(divider());
    parts.push(text("**Recent History:**"));
    for (const snap of recentHistory.slice(-5)) {
      const ts = new Date(snap.timestamp);
      const timeStr = `${ts.toLocaleDateString()} ${ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
      parts.push(
        text(`_${timeStr}_ (${snap.status})\n> ${snap.summary.replace(/\n/g, " ")}`)
      );
    }
  }

  return msg(...parts);
}

export function formatHistory(snapshots: SessionSnapshot[]): Message {
  if (snapshots.length === 0) {
    return msg(headerPart("History"), text("No snapshots recorded yet."));
  }

  const parts: MessagePart[] = [headerPart("History")];

  const recent = snapshots.slice(-15).reverse();
  for (const snap of recent) {
    const ts = new Date(snap.timestamp);
    const timeStr = `${ts.toLocaleDateString()} ${ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    const emoji = STATUS_EMOJI[snap.status as SessionStatus] || "\u26AA";
    const tag = snap.substantialContent ? " [full output]" : "";
    parts.push(
      text(
        `${emoji} \`${snap.sessionId}\` — _${timeStr}_ (${snap.status})${tag}\n> ${snap.summary.replace(/\n/g, " ")}`
      )
    );
  }

  return msg(...parts);
}

export function formatGitSummary(repos: GitRepoStatus[]): Message {
  if (repos.length === 0) {
    return msg(headerPart("Git Status"), text("No repositories configured"));
  }

  const parts: MessagePart[] = [headerPart("Git Status")];

  for (const repo of repos) {
    if (repo.error) {
      parts.push(text(`**${repo.name}** - \u26A0\uFE0F ${repo.error}`));
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

    parts.push(
      text(
        `**${repo.name}** (\`${repo.branch}\`) - ${statusStr}`
      )
    );
  }

  return msg(...parts);
}

export function formatGitDetail(repo: GitRepoStatus): Message {
  const parts: MessagePart[] = [headerPart(`Git: ${repo.name}`)];

  if (repo.error) {
    parts.push(text(`\u26A0\uFE0F ${repo.error}`));
    return msg(...parts);
  }

  parts.push(
    text(
      `**Branch:** \`${repo.branch}\`\n` +
        `**Path:** ${repo.path}\n` +
        `**Ahead/Behind:** ${repo.ahead}/${repo.behind}\n` +
        `**Uncommitted:** ${repo.uncommittedChanges} | **Untracked:** ${repo.untrackedFiles}`
    )
  );

  if (repo.recentCommits.length > 0) {
    parts.push(divider());
    const commitLines = repo.recentCommits
      .map((c) => `\`${c.hash}\` ${c.message} — _${c.author}_`)
      .join("\n");
    parts.push(text(`**Recent Commits:**\n${commitLines}`));
  }

  return msg(...parts);
}

export function formatFullReport(
  system: SystemStatus,
  sessions: ClaudeSession[],
  repos: GitRepoStatus[]
): Message {
  return {
    parts: [
      ...formatSystemStatus(system).parts,
      divider(),
      ...formatAgentList(sessions).parts,
      divider(),
      ...formatGitSummary(repos).parts,
    ],
  };
}

export function formatTmuxSessionList(sessions: TmuxSession[]): Message {
  if (sessions.length === 0) {
    return msg(headerPart("tmux Sessions"), text("No tmux sessions found."));
  }

  const parts: MessagePart[] = [headerPart("tmux Sessions")];

  for (const s of sessions) {
    const age = formatAge(s.created);
    const status = s.attached ? "attached" : "detached";
    parts.push(
      text(
        `\`${s.name}\` — ${s.windows} window(s) | ${status} | created ${age} ago`
      )
    );
  }

  return msg(...parts);
}

export function formatTmuxCapture(
  sessionName: string,
  content: string
): Message {
  return msg(
    headerPart(`Capture: ${sessionName}`),
    { kind: "code", text: content || "(empty)", label: sessionName },
  );
}

export function formatConfirmSend(
  sessionName: string,
  sendText: string,
  actionId: string
): Message {
  return msg(
    text(`**Confirm send to** \`${sessionName}\`:\n> ${sendText}`),
    { kind: "confirm", actionId, session: sessionName, description: sendText },
  );
}

export function formatAuditLog(entries: AuditEntry[]): Message {
  if (entries.length === 0) {
    return msg(headerPart("Audit Log"), text("No actions recorded yet."));
  }

  const parts: MessagePart[] = [headerPart("Audit Log")];

  for (const e of [...entries].reverse().slice(0, 15)) {
    const ts = new Date(e.timestamp);
    const timeStr = `${ts.toLocaleDateString()} ${ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    const icon = e.result === "success" ? "+" : "x";
    const userStr = e.userId ? ` (<@${e.userId}>)` : "";
    parts.push(
      text(
        `\`[${icon}]\` _${timeStr}_ **${e.action}** -> \`${e.target}\`${userStr}\n> ${e.input.slice(0, 100)}${e.detail ? ` — ${e.detail.slice(0, 100)}` : ""}`
      )
    );
  }

  return msg(...parts);
}

export function formatWaitingPrompt(
  sessionId: string,
  tmuxSession: string,
  summary: string | null,
  prompt: WaitingPrompt
): Message {
  const parts: MessagePart[] = [];

  if (summary) {
    parts.push(text(
      `\u{1F7E1} \`${sessionId}\` (${tmuxSession})\n> ${summary.replace(/\n/g, " ")}`
    ));
  } else {
    parts.push(text(`\u{1F7E1} \`${sessionId}\` (${tmuxSession})`));
  }

  parts.push(text(
    `**Needs input:**\n> ${prompt.question.split("\n").map(l => l.slice(0, 300)).join("\n> ")}`
  ));

  if (prompt.options.length > 0) {
    parts.push({
      kind: "question",
      id: sessionId,
      tmuxSession,
      question: prompt.question,
      options: prompt.options,
    });
  } else {
    // Open-ended question — no buttons, user replies with free text
    parts.push(text(`_Reply directly or use_ \`focus ${tmuxSession}\` _to send your answer._`));
  }

  return msg(...parts);
}

// Watcher formatters (moved from watcher.ts inline functions)

interface SessionState {
  status: SessionStatus;
  summary: string;
  waitingQuestion: string | null;
  waitingPrompt: WaitingPrompt | null;
}

export function formatWatcherUpdate(
  sessionId: string,
  tmuxSession: string,
  current: SessionState,
  prev: SessionState | undefined,
  lastResponse?: string
): Message {
  const emoji = STATUS_EMOJI[current.status];
  const parts: MessagePart[] = [];

  if (prev && prev.status !== current.status) {
    parts.push(text(
      `${STATUS_EMOJI[prev.status]} \u2192 ${emoji}  \`${sessionId}\` (${tmuxSession})  **${prev.status}** \u2192 **${current.status}**`
    ));
  }

  if (current.status === "waiting" && current.waitingQuestion) {
    parts.push(text(
      `${emoji} \`${sessionId}\` (${tmuxSession}) needs input:\n> ${current.waitingQuestion.split("\n")[0].slice(0, 200)}`
    ));
    return msg(...parts);
  }

  // When agent just finished, show actual response instead of summary
  if (lastResponse) {
    parts.push(text(lastResponse.slice(0, 3000)));
  } else if (current.summary) {
    parts.push(text(
      `${emoji} \`${sessionId}\` (${tmuxSession})\n> ${current.summary.replace(/\n/g, " ")}`
    ));
  }

  return msg(...parts);
}

export function formatActiveWatchResult(
  sessionId: string,
  tmuxSession: string,
  snapshot: SessionSnapshot,
  newMessages: number,
  commandText?: string,
  lastResponse?: string,
  work?: { filesEdited: string[]; toolCounts: Record<string, number> },
  gitDiff?: string
): Message {
  const emoji = STATUS_EMOJI[snapshot.status];
  const parts: MessagePart[] = [];

  const headerText = commandText
    ? `After sending \`${commandText}\` to \`${tmuxSession}\`:`
    : `Response from \`${tmuxSession}\`:`;

  parts.push(text(headerText));

  if (snapshot.status === "waiting" && snapshot.waitingPrompt) {
    if (lastResponse) {
      parts.push(text(lastResponse.slice(0, 3000)));
      parts.push({ kind: "divider" });
    }
    parts.push(text(
      `**Needs input:**\n> ${snapshot.waitingPrompt.question.split("\n")[0].slice(0, 200)}`
    ));
    if (snapshot.waitingPrompt.options.length > 0) {
      parts.push({
        kind: "question",
        id: sessionId,
        tmuxSession,
        question: snapshot.waitingPrompt.question,
        options: snapshot.waitingPrompt.options,
      });
    } else {
      parts.push(text(`_Reply directly or use_ \`focus ${tmuxSession}\` _to send your answer._`));
    }
  } else if (snapshot.status === "waiting" && snapshot.waitingQuestion) {
    if (lastResponse) {
      parts.push(text(lastResponse.slice(0, 3000)));
      parts.push({ kind: "divider" });
    }
    parts.push(text(
      `${emoji} \`${sessionId}\` needs input:\n> ${snapshot.waitingQuestion.split("\n")[0].slice(0, 200)}`
    ));
  } else if (lastResponse) {
    // Show the actual agent response, not a summary
    parts.push(text(lastResponse.slice(0, 3000)));
  } else if (snapshot.summary) {
    // Fallback to summary if no response text
    parts.push(text(
      `${emoji} \`${sessionId}\`\n> ${snapshot.summary.replace(/\n/g, " ")}`
    ));
  }

  // Append work context: files changed and git diff
  const contextLines: string[] = [];
  if (work?.filesEdited && work.filesEdited.length > 0) {
    contextLines.push(`**Files changed:** ${work.filesEdited.map(f => `\`${f}\``).join(", ")}`);
  }
  if (work?.toolCounts && Object.keys(work.toolCounts).length > 0) {
    contextLines.push(`**Tools:** ${formatToolCounts(work.toolCounts)}`);
  }
  if (gitDiff) {
    contextLines.push(`**Git diff:**`);
  }

  if (contextLines.length > 0) {
    parts.push(divider());
    parts.push(text(contextLines.join("\n")));
    if (gitDiff) {
      parts.push({ kind: "code", text: gitDiff.slice(0, 1500), label: "git diff --stat" });
    }
  }

  return msg(...parts);
}
