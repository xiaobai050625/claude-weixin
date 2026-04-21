/**
 * Heartbeat: scheduled messages to 用户 throughout the day.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

import { DIR, errorText, log, logError } from "./config.js";
import type { HBConfig, HBScheduleEntry } from "./types.js";
import { loadAllowlist } from "./allowlist.js";

// ── Paths ────────────────────────────────────────────────────────────────────

const HB_CONFIG_FILE = path.join(DIR, "heartbeat-config.json");
const HB_SCHEDULE_FILE = path.join(DIR, "heartbeat-schedule.json");

// ── Module-level state ───────────────────────────────────────────────────────

const heartbeatTimers: ReturnType<typeof setTimeout>[] = [];
let midnightTimer: ReturnType<typeof setTimeout> | null = null;
const configHashes = new Map<string, string>();

// ── Config Loading ───────────────────────────────────────────────────────────

export function loadHBConfig(): HBConfig {
  try {
    if (fs.existsSync(HB_CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(HB_CONFIG_FILE, "utf-8"));
    }
  } catch {}
  return {
    fixed: [
      { hour: 5, minute: 30, label: "起床" },
      { hour: 22, minute: 0, label: "睡觉" },
    ],
    random: { active_start: 6, active_end: 22, daily_count: 10, min_per_hour: 1 },
  };
}

// ── Schedule Generation ──────────────────────────────────────────────────────

export function generateDailySchedule(config: HBConfig): HBScheduleEntry[] {
  const { fixed, random } = config;
  const { active_start, active_end, daily_count, min_per_hour } = random;
  const totalHours = active_end - active_start;

  const entries: HBScheduleEntry[] = [];

  for (const f of fixed) {
    entries.push({ hour: f.hour, minute: f.minute, type: "fixed", label: f.label });
  }

  for (let i = 0; i < totalHours; i++) {
    for (let j = 0; j < min_per_hour; j++) {
      const h = active_start + i;
      const m = Math.floor(Math.random() * 60);
      entries.push({ hour: h, minute: m, type: "random" });
    }
  }

  const remaining = Math.max(0, daily_count - totalHours * min_per_hour);
  for (let k = 0; k < remaining; k++) {
    const i = Math.floor(Math.random() * totalHours);
    const h = active_start + i;
    const m = Math.floor(Math.random() * 60);
    entries.push({ hour: h, minute: m, type: "random" });
  }

  entries.sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
  return entries;
}

export function saveSchedule(entries: HBScheduleEntry[]): void {
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const data = { date: dateStr, times: entries };
  fs.writeFileSync(HB_SCHEDULE_FILE, JSON.stringify(data, null, 2), "utf-8");
  log(`💓 时间表已写入（${entries.length} 条）`);
}

// ── Reload ───────────────────────────────────────────────────────────────────

export function reloadHeartbeat(server: Server): number {
  // 1. 清掉所有 heartbeat timer
  for (const t of heartbeatTimers) clearTimeout(t);
  heartbeatTimers.length = 0;

  // 2. 重新读配置
  const config = loadHBConfig();

  // 3. 更新配置哈希
  try {
    const content = fs.readFileSync(HB_CONFIG_FILE, "utf-8");
    configHashes.set(HB_CONFIG_FILE, crypto.createHash("md5").update(content).digest("hex"));
  } catch {}

  // 4. 找目标用户
  const list = loadAllowlist();
  const target = list.allowed[0];
  if (!target) {
    log("💓 heartbeat: 没有授权用户，跳过");
    return 0;
  }

  // 5. 总是重新生成 schedule
  const entries = generateDailySchedule(config);
  saveSchedule(entries);

  // 6. 构建触发函数
  const fireHeartbeat = async (entry: HBScheduleEntry) => {
    const timeStr = `${String(entry.hour).padStart(2, "0")}:${String(entry.minute).padStart(2, "0")}`;
    const labelStr = entry.label ? `（${entry.label}）` : "";

    log(`💓 heartbeat @ ${timeStr}${labelStr} → ${target.nickname}`);

    await server.notification({
      method: "notifications/claude/channel",
      params: {
        content: `[heartbeat] 现在是 ${timeStr}${labelStr}。根据时间段给用户发一条自然的微信消息，不要机械化。如果正在聊天就不用发。如果无法发送就跳过。`,
        meta: {
          sender: "heartbeat",
          sender_id: target.id,
        },
      },
    });
  };

  // 7. 为未来的时间点排定 timer
  const now = new Date();
  let scheduled = 0;
  for (const entry of entries) {
    const t = new Date(now);
    t.setHours(entry.hour, entry.minute, 0, 0);
    const delayMs = t.getTime() - now.getTime();
    if (delayMs > 0) {
      heartbeatTimers.push(setTimeout(() => {
        fireHeartbeat(entry).catch(err => logError(`Heartbeat error: ${errorText(err)}。下一步：确认 Claude Code channel 仍在运行。`));
      }, delayMs));
      scheduled++;
    }
  }

  log(`💓 今日已排定 ${scheduled}/${entries.length} 条 heartbeat`);
  return scheduled;
}

// ── Config File Watcher ──────────────────────────────────────────────────────

export function startConfigWatcher(server: Server) {
  try {
    fs.watch(DIR, (_eventType, filename) => {
      if (!filename || filename !== "heartbeat-config.json") return;

      let content: string;
      try {
        content = fs.readFileSync(HB_CONFIG_FILE, "utf-8");
      } catch {
        return;
      }

      const newHash = crypto.createHash("md5").update(content).digest("hex");
      if (configHashes.get(HB_CONFIG_FILE) === newHash) return;

      configHashes.set(HB_CONFIG_FILE, newHash);
      log("🔄 hot-reload: heartbeat-config.json 已变更，重新加载");

      const count = reloadHeartbeat(server);
      log(`🔄 hot-reload: ${count} 条 heartbeat 已重新排定`);
    });

    log("👁 fs.watch: 监听配置目录");
  } catch (err) {
    logError(`fs.watch 启动失败: ${errorText(err)}。下一步：手动调用 wechat_reload_heartbeat 刷新心跳配置。`);
  }
}

// ── Start ────────────────────────────────────────────────────────────────────

export function startHeartbeat(server: Server) {
  // 初始化配置哈希
  try {
    const content = fs.readFileSync(HB_CONFIG_FILE, "utf-8");
    configHashes.set(HB_CONFIG_FILE, crypto.createHash("md5").update(content).digest("hex"));
  } catch {}

  // 排定今天的 heartbeat
  reloadHeartbeat(server);

  // 每天零点重新生成（midnightTimer 单独存，reload 不清它）
  const scheduleMidnight = () => {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setDate(midnight.getDate() + 1);
    midnight.setHours(0, 0, 0, 0);
    const delayMs = midnight.getTime() - now.getTime();

    midnightTimer = setTimeout(() => {
      reloadHeartbeat(server);
      scheduleMidnight();
    }, delayMs);

    log(`💓 下次时间表生成: 明天 00:00（${Math.round(delayMs / 1000 / 60)} 分钟后）`);
  };

  scheduleMidnight();

  // 启动配置文件监听
  startConfigWatcher(server);
}
