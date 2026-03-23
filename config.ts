/**
 * Shared configuration constants and logging for the WeChat Channel plugin.
 */

import path from "node:path";

// ── Channel Identity ─────────────────────────────────────────────────────────

export const CHANNEL_NAME = "wechat";
export const CHANNEL_VERSION = "0.1.0";

// ── Paths ────────────────────────────────────────────────────────────────────

export const DIR = process.env.WECHAT_CHANNEL_DIR || path.join(
  process.env.HOME || "~",
  ".claude",
  "channels",
  "wechat",
);
export const CRED_FILE = path.join(DIR, "account.json");
export const ALLOW_FILE = path.join(DIR, "allowlist.json");
export const SYNC_FILE = path.join(DIR, "sync_buf.txt");
export const CTX_FILE = path.join(DIR, "context_tokens.json");
export const CHAT_LOG_FILE = path.join(DIR, "chat_history.jsonl");
export const MEDIA_DIR = path.join(DIR, "media");

// ── CDN ──────────────────────────────────────────────────────────────────────

export const CDN_BASE = "https://novac2c.cdn.weixin.qq.com/c2c";
export const CDN_DOWNLOAD_URL = `${CDN_BASE}/download`;
export const CDN_UPLOAD_URL = `${CDN_BASE}/upload`;

// ── Timeouts ─────────────────────────────────────────────────────────────────

export const LONG_POLL_TIMEOUT_MS = 35_000;
export const MAX_CONSECUTIVE_FAILURES = 3;
export const BACKOFF_DELAY_MS = 30_000;
export const RETRY_DELAY_MS = 2_000;
export const REPLAY_MAX = 200;

// ── Logging (stderr only — stdout is MCP stdio) ─────────────────────────────

export function log(msg: string) {
  process.stderr.write(`[wechat] ${msg}\n`);
}

export function logError(msg: string) {
  process.stderr.write(`[wechat] ERROR: ${msg}\n`);
}
