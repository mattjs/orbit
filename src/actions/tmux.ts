import { execSync } from "child_process";

export interface TmuxSession {
  name: string;
  created: Date;
  windows: number;
  attached: boolean;
}

export function listTmuxSessions(): TmuxSession[] {
  try {
    const output = execSync(
      "tmux list-sessions -F '#{session_name} #{session_created} #{session_windows} #{session_attached}'",
      { encoding: "utf-8", timeout: 5000 }
    ).trim();

    if (!output) return [];

    return output.split("\n").map((line) => {
      const parts = line.split(" ");
      return {
        name: parts[0],
        created: new Date(parseInt(parts[1], 10) * 1000),
        windows: parseInt(parts[2], 10) || 1,
        attached: parts[3] === "1",
      };
    });
  } catch {
    return [];
  }
}

export function tmuxSessionExists(sessionName: string): boolean {
  try {
    execSync(`tmux has-session -t ${shellEscape(sessionName)}`, {
      encoding: "utf-8",
      timeout: 5000,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

export function captureTmuxPane(sessionName: string, lines = 80): string {
  if (!tmuxSessionExists(sessionName)) {
    throw new Error(`tmux session '${sessionName}' not found`);
  }

  const output = execSync(
    `tmux capture-pane -t ${shellEscape(sessionName)} -p -S -${lines}`,
    { encoding: "utf-8", timeout: 5000 }
  );

  // Truncate to ~3000 chars for Slack block limits
  const trimmed = output.trimEnd();
  if (trimmed.length > 3000) {
    return "...(truncated)\n" + trimmed.slice(-2950);
  }
  return trimmed;
}

export function sendToTmux(
  sessionName: string,
  text: string,
  pressEnter: boolean
): void {
  if (!tmuxSessionExists(sessionName)) {
    throw new Error(`tmux session '${sessionName}' not found`);
  }

  // Use -l (literal mode) so text is never interpreted as key names
  // Shell-escape with single quotes
  execSync(
    `tmux send-keys -t ${shellEscape(sessionName)} -l ${shellEscape(text)}`,
    { encoding: "utf-8", timeout: 5000 }
  );

  if (pressEnter) {
    execSync(
      `tmux send-keys -t ${shellEscape(sessionName)} Enter`,
      { encoding: "utf-8", timeout: 5000 }
    );
  }
}

/** Shell-escape a string using single quotes */
function shellEscape(s: string): string {
  // Wrap in single quotes, escaping any internal single quotes: ' → '\''
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
