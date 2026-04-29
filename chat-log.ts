/**
 * 聊天记录：context_token 缓存 + 消息历史持久化
 */

import fs from "node:fs";

import { CTX_FILE, CHAT_LOG_FILE, log } from "./config.js";
import type { ChatLogEntry } from "./types.js";

// ── Context Token 缓存 ────────────────────────────────────────────────────────

export const contextTokens = new Map<string, string>();

export function loadContextTokens(): void {
  try {
    if (fs.existsSync(CTX_FILE)) {
      const data = JSON.parse(fs.readFileSync(CTX_FILE, "utf-8"));
      for (const [k, v] of Object.entries(data)) {
        if (typeof v === "string") contextTokens.set(k, v);
      }
      log(`恢复 ${contextTokens.size} 个 context_token`);
    }
  } catch {}
}

export function saveContextTokens(): void {
  const obj: Record<string, string> = {};
  for (const [k, v] of contextTokens) {
    obj[k] = v;
  }
  try {
    fs.writeFileSync(CTX_FILE, JSON.stringify(obj, null, 2), { encoding: "utf-8", mode: 0o600 });
  } catch {}
}

// ── 聊天记录 ──────────────────────────────────────────────────────────────────

export function loadChatLog(): ChatLogEntry[] {
  try {
    if (!fs.existsSync(CHAT_LOG_FILE)) return [];
    const raw = fs.readFileSync(CHAT_LOG_FILE, "utf-8").trim();
    if (!raw) return [];
    const entries: ChatLogEntry[] = [];
    for (const line of raw.split("\n")) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        // 跳过损坏的行
      }
    }
    return entries;
  } catch {
    return [];
  }
}

/**
 * 只读取文件尾部最近的 N 条聊天记录，避免全量加载。
 * JSONL 每条约 150-300 字节，读 16KB 足够覆盖几十条。
 */
export function loadRecentChatLog(maxEntries: number): ChatLogEntry[] {
  try {
    if (!fs.existsSync(CHAT_LOG_FILE)) return [];
    const stat = fs.statSync(CHAT_LOG_FILE);
    if (stat.size === 0) return [];

    // 只读尾部
    const tailSize = Math.min(stat.size, 16 * 1024);
    const fd = fs.openSync(CHAT_LOG_FILE, "r");
    const buf = Buffer.alloc(tailSize);
    fs.readSync(fd, buf, 0, tailSize, stat.size - tailSize);
    fs.closeSync(fd);

    const raw = buf.toString("utf-8");
    // 跳过第一条可能不完整的行
    const lines = raw.split("\n");
    const cleanLines = raw.charCodeAt(0) !== 0x7B ? lines.slice(1) : lines;

    const entries: ChatLogEntry[] = [];
    for (const line of cleanLines) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        // 跳过损坏的行
      }
    }
    return entries.slice(-maxEntries);
  } catch {
    return [];
  }
}

export function appendChatLog(entry: ChatLogEntry): void {
  try {
    fs.appendFileSync(CHAT_LOG_FILE, JSON.stringify(entry) + "\n", { encoding: "utf-8", mode: 0o600 });
  } catch {}
}
