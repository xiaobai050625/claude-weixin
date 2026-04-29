/**
 * Claude-weixin 配置常量
 */

import path from "node:path";

export const CHANNEL_NAME = "weixin";
export const CHANNEL_VERSION = "1.0.0";

// ── 路径 ──────────────────────────────────────────────────────────────────────

export const DIR = process.env.WEIXIN_DIR || path.join(
  process.env.HOME || "~",
  ".claude",
  "weixin",
);
export const CRED_FILE = path.join(DIR, "account.json");
export const ALLOW_FILE = path.join(DIR, "allowlist.json");
export const SYNC_FILE = path.join(DIR, "sync_buf.txt");
export const CTX_FILE = path.join(DIR, "context_tokens.json");
export const CHAT_LOG_FILE = path.join(DIR, "chat_history.jsonl");
export const MEDIA_DIR = path.join(DIR, "media");

// ── CDN ───────────────────────────────────────────────────────────────────────

export const CDN_BASE = "https://novac2c.cdn.weixin.qq.com/c2c";
export const CDN_DOWNLOAD_URL = `${CDN_BASE}/download`;
export const CDN_UPLOAD_URL = `${CDN_BASE}/upload`;

// ── 超时和重试 ────────────────────────────────────────────────────────────────

export const LONG_POLL_TIMEOUT_MS = 35_000;
export const MAX_CONSECUTIVE_FAILURES = 3;
export const BACKOFF_DELAY_MS = 30_000;
export const RETRY_DELAY_MS = 2_000;
export const REPLAY_MAX = 20;

// ── 日志 (stderr — 不影响 stdout) ─────────────────────────────────────────────

export function sanitizeText(value: unknown): string {
  return String(value)
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot[redacted]")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-[redacted]")
    .replace(/(token|bot_token|access_token|refresh_token|api_key|apikey|secret)(["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, "$1$2[redacted]")
    .replace(/([?&](?:token|access_token|bot_token|key|secret)=)[^&\s]+/gi, "$1[redacted]");
}

export function errorText(err: unknown): string {
  if (err instanceof Error && err.name === "AbortError") {
    return "请求超时";
  }
  return sanitizeText(err);
}

export function log(msg: string) {
  process.stderr.write(`[weixin] ${msg}\n`);
}

export function logError(msg: string) {
  process.stderr.write(`[weixin] ERROR: ${sanitizeText(msg)}\n`);
}
