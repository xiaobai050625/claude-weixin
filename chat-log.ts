/**
 * 聊天记录：context_token 缓存 + 消息历史持久化 + 增量上传游标
 */

import fs from "node:fs";
import crypto from "node:crypto";

import { CTX_FILE, CHAT_LOG_FILE, STATE_FILE, log } from "./config.js";
import type { ChatLogEntry, ChatState } from "./types.js";

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

// ── 内容 Hash ──────────────────────────────────────────────────────────────────

function computeHash(entry: ChatLogEntry): string {
  const input = `${entry.ts}|${entry.direction}|${entry.from}|${entry.text}`;
  return crypto.createHash("sha256").update(input, "utf-8").digest("hex").slice(0, 8);
}

// ── 写锁队列（防止 JSONL 并发写入损坏）─────────────────────────────────────────

let writeQueue: Promise<void> = Promise.resolve();

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

    const tailSize = Math.min(stat.size, 16 * 1024);
    const fd = fs.openSync(CHAT_LOG_FILE, "r");
    const buf = Buffer.alloc(tailSize);
    fs.readSync(fd, buf, 0, tailSize, stat.size - tailSize);
    fs.closeSync(fd);

    const raw = buf.toString("utf-8");
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

/**
 * 追加一条聊天记录（串行写队列，防止并发损坏）。
 * 自动计算 contentHash，sentToClaude 初始为 false。
 */
export function appendChatLog(entry: ChatLogEntry): void {
  writeQueue = writeQueue.then(() => {
    try {
      const entryWithMeta: ChatLogEntry = {
        ...entry,
        contentHash: computeHash(entry),
        sentToClaude: false,
      };
      fs.appendFileSync(CHAT_LOG_FILE, JSON.stringify(entryWithMeta) + "\n", {
        encoding: "utf-8",
        mode: 0o600,
      });
    } catch {
      // 写入失败静默跳过，不影响消息处理
    }
  });
}

// ── 增量游标状态 ───────────────────────────────────────────────────────────────

export function loadState(): ChatState {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, "utf-8");
      const state: ChatState = JSON.parse(raw);
      // 容错校验：游标不能超过当前文件大小
      if (fs.existsSync(CHAT_LOG_FILE)) {
        const actualSize = fs.statSync(CHAT_LOG_FILE).size;
        if (state.lastByteOffset > actualSize) {
          log(`游标越界 (${state.lastByteOffset} > ${actualSize})，降级为安全模式`);
          return { lastByteOffset: 0, lastHash: "", updatedAt: "" };
        }
      }
      if (typeof state.lastByteOffset === "number" && typeof state.lastHash === "string") {
        return state;
      }
    }
  } catch {}
  return { lastByteOffset: 0, lastHash: "", updatedAt: "" };
}

export function saveState(state: ChatState): void {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state), {
      encoding: "utf-8",
      mode: 0o600,
    });
  } catch {}
}

/**
 * 增量加载：只读取游标之后、尚未发送给 Claude 的新消息。
 * 返回最近 N 条未发送记录。
 */
export function loadUnsynchronizedChatLog(maxEntries: number): ChatLogEntry[] {
  try {
    if (!fs.existsSync(CHAT_LOG_FILE)) return [];
    const fileSize = fs.statSync(CHAT_LOG_FILE).size;
    const state = loadState();

    // 游标已在文件末尾 → 无新消息
    if (state.lastByteOffset >= fileSize) return [];

    // 从游标位置读取新内容
    const readSize = Math.min(fileSize - state.lastByteOffset, 32 * 1024);
    const fd = fs.openSync(CHAT_LOG_FILE, "r");
    const buf = Buffer.alloc(readSize);
    fs.readSync(fd, buf, 0, readSize, state.lastByteOffset);
    fs.closeSync(fd);

    const raw = buf.toString("utf-8");
    // 跳过第一条可能不完整的行
    const lines = raw.split("\n").filter((l) => l.trim());
    const firstChar = raw.charCodeAt(0);
    const cleanLines = firstChar !== 0x7B ? lines.slice(1) : lines;

    const entries: ChatLogEntry[] = [];
    for (const line of cleanLines) {
      try {
        const entry = JSON.parse(line);
        if (!entry.sentToClaude) {
          entries.push(entry);
        }
      } catch {
        // 跳过损坏的行
      }
    }
    return entries.slice(-maxEntries);
  } catch {
    return [];
  }
}

/**
 * 更新游标：将当前文件末尾标记为"已发送"位置。
 */
export function markChatLogSent(): void {
  try {
    if (!fs.existsSync(CHAT_LOG_FILE)) return;
    const fileSize = fs.statSync(CHAT_LOG_FILE).size;
    const state = loadState();
    state.lastByteOffset = fileSize;
    state.lastHash = "";
    state.updatedAt = new Date().toISOString();
    saveState(state);
  } catch {}
}
