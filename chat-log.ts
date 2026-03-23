/**
 * Chat log: context token cache + message history for replay on restart.
 */

import fs from "node:fs";

import { CTX_FILE, CHAT_LOG_FILE, REPLAY_MAX, log, logError } from "./config.js";
import type { ChatLogEntry } from "./types.js";

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

// ── Context Token Cache (persisted) ──────────────────────────────────────────

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

// ── Chat Log (recent messages for replay on restart) ─────────────────────────

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
        // skip corrupt lines
      }
    }
    return entries;
  } catch {
    return [];
  }
}

export function appendChatLog(entry: ChatLogEntry): void {
  try {
    fs.appendFileSync(CHAT_LOG_FILE, JSON.stringify(entry) + "\n", { encoding: "utf-8", mode: 0o600 });
  } catch {}
}

export async function replayHistory(server: InstanceType<typeof Server>): Promise<void> {
  try {
    const allEntries = loadChatLog();
    if (allEntries.length === 0) {
      log("无历史记录可回放");
      return;
    }

    const entries = allEntries.slice(-REPLAY_MAX);
    log(`准备回放 ${entries.length} 条历史消息（共 ${allEntries.length} 条）...`);

    const fmt = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
    const lines = entries.map((e) => {
      const d = new Date(e.ts);
      const parts = fmt.formatToParts(d);
      const get = (t: string) => parts.find(p => p.type === t)?.value ?? '00';
      const label = e.direction === "in" ? e.from : "Claude（上一个实例）";
      return `[${get('month')}-${get('day')} ${get('hour')}:${get('minute')}] ${label}: ${e.text}`;
    });

    const content = `【历史记录】以下是重启前的微信对话，仅用于恢复上下文。\n\n${lines.join("\n")}\n\n【历史记录结束】以上全部是过去的对话，不要回复、不要评论、不要调用任何工具。安静等待新的微信消息到达。`;

    await server.notification({
      method: "notifications/claude/channel",
      params: {
        content,
        meta: {
          sender: "system",
          sender_id: "system",
        },
      },
    });

    log(`✅ 已回放 ${entries.length} 条历史消息`);
  } catch (err) {
    logError(`历史回放失败: ${String(err)}`);
  }
}
