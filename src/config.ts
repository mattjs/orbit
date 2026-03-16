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
    watchMessageThreshold?: number;
    watchActiveTimeoutMs?: number;
  };
  web?: {
    enabled: boolean;
    port: number;
    auth: { username: string; password: string };
    tls?: { cert: string; key: string };
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

  const hasSlack = parsed?.slack?.appToken && parsed?.slack?.botToken && parsed?.slack?.channel;

  return {
    slack: hasSlack ? {
      appToken: parsed.slack.appToken,
      botToken: parsed.slack.botToken,
      channel: parsed.slack.channel,
    } : {
      appToken: "",
      botToken: "",
      channel: "cli",
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
      watchMessageThreshold: parsed.actions?.watchMessageThreshold ?? 10,
      watchActiveTimeoutMs: parsed.actions?.watchActiveTimeoutMs ?? 60000,
    },
    web: parsed.web?.enabled
      ? {
          enabled: true,
          port: parsed.web.port ?? 3000,
          auth: {
            username: parsed.web.auth?.username ?? "admin",
            password: parsed.web.auth?.password ?? "changeme",
          },
          tls: parsed.web.tls?.cert && parsed.web.tls?.key
            ? { cert: parsed.web.tls.cert, key: parsed.web.tls.key }
            : undefined,
        }
      : undefined,
  };
}
