#!/usr/bin/env npx tsx
/**
 * Integration test for the Orbit watcher pipeline.
 *
 * This test:
 * 1. Enables recording
 * 2. Creates a tmux session with an interactive Claude agent
 * 3. Waits for Claude to start and become visible to the watcher
 * 4. Sends a command to the agent via Orbit
 * 5. Waits for the active watch to post a result via SSE
 * 6. Validates the result contains meaningful content
 * 7. Checks recordings for debugging data
 * 8. Cleans up
 *
 * Prerequisites:
 *   - Orbit service running
 *   - Claude Code installed and in PATH
 *   - ANTHROPIC_API_KEY set
 *
 * Usage:
 *   npx tsx test/integration/watcher-test.ts
 */

// Skip TLS verification for self-signed certs
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { execSync } from "child_process";
import { readFileSync, unlinkSync, existsSync, readdirSync } from "fs";

// ------------------------------------------------------------------
// Config
// ------------------------------------------------------------------

const BASE = "https://localhost/api";
const AUTH_HEADER = `Basic ${Buffer.from("admin:changeme").toString("base64")}`;
const TEST_SESSION = `orbit-test-${Date.now()}`;
const TEST_DIR = "/tmp";

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

async function api<T = any>(path: string, options?: { method?: string; body?: unknown }): Promise<T> {
  const url = `${BASE}${path}`;
  const headers: Record<string, string> = { Authorization: AUTH_HEADER };
  const init: any = { method: options?.method ?? "GET", headers };

  if (options?.body) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }

  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`  [${ts}] ${msg}`);
}

function tmux(cmd: string): string {
  return execSync(`tmux ${cmd}`, { encoding: "utf-8", timeout: 5000 }).trim();
}

function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

// ------------------------------------------------------------------
// Test steps
// ------------------------------------------------------------------

const results: { name: string; pass: boolean; detail?: string }[] = [];

function assert(name: string, condition: boolean, detail?: string) {
  results.push({ name, pass: condition, detail });
  const icon = condition ? "✓" : "✗";
  console.log(`  ${icon} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function setup() {
  log("Enabling recording...");
  await api("/recordings/toggle", { method: "POST", body: { enabled: true } });

  log("Clearing chat focus...");
  await api("/chat", { method: "POST", body: { text: "unfocus" } });
}

async function createSessionAndLaunchClaude() {
  log(`Creating tmux session: ${TEST_SESSION}`);
  tmux(`new-session -d -s ${TEST_SESSION} -c ${TEST_DIR}`);

  // Launch Claude interactively
  log("Launching Claude interactively...");
  const claudeCmd = "claude";
  tmux(`send-keys -t ${shellEscape(TEST_SESSION)} ${shellEscape(claudeCmd)} Enter`);

  // Wait for Claude to start — check pane_current_command becomes "claude"
  log("Waiting for Claude process to start...");
  let started = false;
  for (let i = 0; i < 30; i++) {
    await sleep(3000);
    try {
      const panes = tmux("list-panes -a -F '#{session_name} #{pane_current_command}'");
      if (panes.includes(`${TEST_SESSION} claude`)) {
        log("Claude process detected in tmux.");
        started = true;
        break;
      }
    } catch { /* retry */ }
  }

  if (!started) {
    // Check what happened
    try {
      const capture = tmux(`capture-pane -t ${shellEscape(TEST_SESSION)} -p`);
      log(`Session output:\n${capture.slice(-300)}`);
    } catch { /* ignore */ }
    throw new Error("Claude did not start within 90s");
  }

  // Send an initial message to Claude to create the JSONL session
  log("Sending initial prompt to Claude...");
  await sleep(3000); // Wait for Claude's input prompt to appear
  const initPrompt = 'say "hello, I am ready" and nothing else';
  tmux(`send-keys -t ${shellEscape(TEST_SESSION)} -l ${shellEscape(initPrompt)}`);
  tmux(`send-keys -t ${shellEscape(TEST_SESSION)} Enter`);

  // Wait for JSONL session to be created (Claude needs to process the message)
  log("Waiting for JSONL session to initialize...");
  await sleep(15000);
}

async function waitForAgentVisible(): Promise<boolean> {
  log("Waiting for agent to be visible to Orbit...");
  for (let i = 0; i < 20; i++) {
    try {
      const agents = await api<any[]>("/agents/live");
      const found = agents.find((a: any) => a.tmuxSession === TEST_SESSION);
      if (found) {
        log(`Agent visible: ${found.id} (${found.status}, ${found.messageCount} messages)`);
        return true;
      }
    } catch (e: any) {
      log(`Check failed: ${e.message}`);
    }
    await sleep(3000);
  }
  log("Agent not visible after 60s");
  return false;
}

async function sendCommandAndCollect(): Promise<{ messages: any[]; duration: number }> {
  const startTime = Date.now();

  // Focus on the test session
  log(`Focusing on ${TEST_SESSION}...`);
  await api("/chat", { method: "POST", body: { text: `focus ${TEST_SESSION}` } });

  // Send a simple task
  const task = `create a file at /tmp/orbit-test-result-${Date.now()}.txt with the text "integration test passed"`;
  log(`Sending task: "${task.slice(0, 80)}..."`);
  const sendResult = await api<any>("/chat", { method: "POST", body: { text: task } });
  log(`Send response: ${sendResult.text}`);

  // Poll chat history for system messages (watcher results)
  log("Waiting for watcher to post result...");
  const collected: any[] = [];

  for (let i = 0; i < 60; i++) {
    await sleep(5000);

    const history = await api<any[]>("/chat/history?limit=30");
    const systemMessages = history.filter(
      (m: any) => m.sender === "system" && new Date(m.timestamp).getTime() > startTime
    );

    if (systemMessages.length > collected.length) {
      const newMessages = systemMessages.slice(collected.length);
      for (const msg of newMessages) {
        const parsed = msg.messageJson ? JSON.parse(msg.messageJson) : null;
        const textContent = parsed?.parts
          ?.filter((p: any) => p.kind === "text")
          .map((p: any) => p.text.slice(0, 100))
          .join(" | ");
        log(`New message: ${textContent || "(no text)"}`);
      }
      collected.push(...newMessages);

      // Check if any message looks like a final result (not just a status update)
      const hasFinalResult = collected.some((m: any) => {
        const p = m.messageJson ? JSON.parse(m.messageJson) : null;
        return p?.parts?.some((part: any) =>
          part.kind === "text" && (
            part.text.includes("After sending") ||
            part.text.includes("Response from") ||
            part.text.includes("Files changed")
          )
        );
      });

      if (hasFinalResult) {
        log("Got final result from watcher!");
        break;
      }
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    if (i % 6 === 5) log(`Still waiting... (${elapsed}s elapsed)`);
  }

  return { messages: collected, duration: Date.now() - startTime };
}

async function analyzeResults(messages: any[], duration: number) {
  console.log("\n--- Analysis ---");

  assert("Watcher posted at least one message", messages.length > 0, `got ${messages.length}`);

  // Check for substantive content
  let hasResponseText = false;
  let hasFilesChanged = false;
  let hasGitDiff = false;
  let totalTextLength = 0;

  for (const msg of messages) {
    const parsed = msg.messageJson ? JSON.parse(msg.messageJson) : null;
    if (!parsed?.parts) continue;

    for (const part of parsed.parts) {
      if (part.kind === "text") {
        totalTextLength += part.text.length;
        if (part.text.length > 100) hasResponseText = true;
        if (part.text.includes("Files changed")) hasFilesChanged = true;
        if (part.text.includes("Git diff")) hasGitDiff = true;
      }
    }
  }

  assert("Result contains substantive text (>100 chars)", hasResponseText, `total text: ${totalTextLength} chars`);
  assert("Result includes files changed", hasFilesChanged);
  // Git diff is optional for non-git dirs
  assert("Active watch completed in <3min", duration < 180_000, `took ${Math.round(duration / 1000)}s`);

  // Check recordings
  const recordings = await api<{ recordings: any[] }>("/recordings");
  const testRecording = recordings.recordings.find((r: any) => r.tmuxSession === TEST_SESSION);
  assert("Recording captured for test session", !!testRecording, testRecording ? `${testRecording.pollCount} polls` : "not found");
}

async function cleanup() {
  log("Cleaning up...");

  // Unfocus
  try { await api("/chat", { method: "POST", body: { text: "unfocus" } }); } catch { /* ok */ }

  // Kill tmux session
  try {
    tmux(`kill-session -t ${shellEscape(TEST_SESSION)}`);
    log(`Killed tmux session ${TEST_SESSION}`);
  } catch (e: any) {
    log(`Note: ${e.message}`);
  }

  // Disable recording
  try { await api("/recordings/toggle", { method: "POST", body: { enabled: false } }); } catch { /* ok */ }

  // Clean up test files
  try {
    const testFiles = readdirSync("/tmp").filter(f => f.startsWith("orbit-test-"));
    for (const f of testFiles) {
      try { unlinkSync(`/tmp/${f}`); } catch { /* ok */ }
    }
    if (testFiles.length > 0) log(`Cleaned up ${testFiles.length} test file(s)`);
  } catch { /* ok */ }
}

// ------------------------------------------------------------------
// Main
// ------------------------------------------------------------------

async function main() {
  console.log("\n╔══════════════════════════════════════╗");
  console.log("║  Orbit Watcher Integration Test      ║");
  console.log("╚══════════════════════════════════════╝\n");

  try {
    console.log("1. Setup");
    await setup();

    console.log("\n2. Create session & launch Claude");
    await createSessionAndLaunchClaude();

    console.log("\n3. Wait for agent visibility");
    const visible = await waitForAgentVisible();
    assert("Agent visible to Orbit", visible);

    if (!visible) {
      console.log("\nABORT: Agent not visible. Cannot continue.");
      return;
    }

    console.log("\n4. Send command & collect watcher output");
    const { messages, duration } = await sendCommandAndCollect();

    console.log("\n5. Analyze");
    await analyzeResults(messages, duration);

  } catch (err) {
    console.error("\nFATAL:", err);
  } finally {
    console.log("\n6. Cleanup");
    await cleanup();

    // Summary
    console.log("\n╔══════════════════════════════════════╗");
    console.log("║  Results                             ║");
    console.log("╚══════════════════════════════════════╝");
    const passed = results.filter(r => r.pass).length;
    const failed = results.filter(r => !r.pass).length;
    for (const r of results) {
      console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}${r.detail ? ` (${r.detail})` : ""}`);
    }
    console.log(`\n  ${passed} passed, ${failed} failed\n`);

    process.exit(failed > 0 ? 1 : 0);
  }
}

main();
