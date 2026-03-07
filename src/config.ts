import { readFileSync, existsSync } from "fs";
import { parse } from "yaml";
import { resolve } from "path";
import { homedir } from "os";

export interface Config {
  slack: {
    appToken: string;
    botToken: string;
    channel: string;
  };
  claude: {
    sessionDirs: string[];
  };
  git: {
    repos: string[];
  };
  scheduler: {
    enabled: boolean;
    intervalMinutes: number;
  };
  anthropic?: {
    apiKey?: string;
  };
  actions?: {
    confirmDangerous?: boolean;
    captureDelayMs?: number;
    allowedCommands?: string[];
  };
}

const DEFAULT_CONFIG_PATH = resolve(homedir(), ".orbit", "config.yaml");

export function loadConfig(configPath?: string): Config {
  const path = configPath ?? DEFAULT_CONFIG_PATH;

  if (!existsSync(path)) {
    throw new Error(
      `Config file not found at ${path}. Copy config.example.yaml to ${DEFAULT_CONFIG_PATH} and fill in your tokens.`
    );
  }

  const raw = readFileSync(path, "utf-8");
  const parsed = parse(raw);

  if (!parsed?.slack?.appToken || !parsed?.slack?.botToken) {
    throw new Error("Config must include slack.appToken and slack.botToken");
  }
  if (!parsed?.slack?.channel) {
    throw new Error("Config must include slack.channel");
  }

  return {
    slack: {
      appToken: parsed.slack.appToken,
      botToken: parsed.slack.botToken,
      channel: parsed.slack.channel,
    },
    claude: {
      sessionDirs: parsed.claude?.sessionDirs ?? [
        resolve(homedir(), ".claude", "projects"),
      ],
    },
    git: {
      repos: parsed.git?.repos ?? [],
    },
    scheduler: {
      enabled: parsed.scheduler?.enabled ?? false,
      intervalMinutes: parsed.scheduler?.intervalMinutes ?? 30,
    },
    anthropic: parsed.anthropic
      ? { apiKey: parsed.anthropic.apiKey }
      : undefined,
    actions: {
      confirmDangerous: parsed.actions?.confirmDangerous ?? true,
      captureDelayMs: parsed.actions?.captureDelayMs ?? 3000,
      allowedCommands: parsed.actions?.allowedCommands ?? [
        "y",
        "yes",
        "no",
      ],
    },
  };
}
