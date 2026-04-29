/**
 * 心跳调度：定时触发消息，让 Claude 主动联系用户。
 * 不依赖 MCP Channels，改用回调函数触发 Claude CLI。
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { DIR, errorText, log, logError } from "./config.js";
import type { HBConfig, HBScheduleEntry } from "./types.js";
import { loadAllowlist } from "./allowlist.js";

const HB_CONFIG_FILE = path.join(DIR, "heartbeat-config.json");
const HB_SCHEDULE_FILE = path.join(DIR, "heartbeat-schedule.json");

const heartbeatTimers: ReturnType<typeof setTimeout>[] = [];
let midnightTimer: ReturnType<typeof setTimeout> | null = null;
const configHashes = new Map<string, string>();

type HeartbeatCallback = (senderId: string, nickname: string, timeStr: string, label: string) => void;
let onHeartbeat: HeartbeatCallback | null = null;

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

export function reloadHeartbeat(): number {
  for (const t of heartbeatTimers) clearTimeout(t);
  heartbeatTimers.length = 0;

  const config = loadHBConfig();

  try {
    const content = fs.readFileSync(HB_CONFIG_FILE, "utf-8");
    configHashes.set(HB_CONFIG_FILE, crypto.createHash("md5").update(content).digest("hex"));
  } catch {}

  const list = loadAllowlist();
  const target = list.allowed[0];
  if (!target) {
    log("💓 heartbeat: 没有授权用户，跳过");
    return 0;
  }

  const entries = generateDailySchedule(config);
  saveSchedule(entries);

  const fireHeartbeat = (entry: HBScheduleEntry) => {
    const timeStr = `${String(entry.hour).padStart(2, "0")}:${String(entry.minute).padStart(2, "0")}`;
    const labelStr = entry.label || "";
    log(`💓 heartbeat @ ${timeStr}${entry.label ? `（${entry.label}）` : ""} → ${target.nickname}`);

    if (onHeartbeat) {
      onHeartbeat(target.id, target.nickname, timeStr, labelStr);
    }
  };

  const now = new Date();
  let scheduled = 0;
  for (const entry of entries) {
    const t = new Date(now);
    t.setHours(entry.hour, entry.minute, 0, 0);
    const delayMs = t.getTime() - now.getTime();
    if (delayMs > 0) {
      heartbeatTimers.push(setTimeout(() => { fireHeartbeat(entry); }, delayMs));
      scheduled++;
    }
  }

  log(`💓 今日已排定 ${scheduled}/${entries.length} 条 heartbeat`);
  return scheduled;
}

function startConfigWatcher() {
  try {
    fs.watch(DIR, (_eventType, filename) => {
      if (!filename || filename !== "heartbeat-config.json") return;
      let content: string;
      try { content = fs.readFileSync(HB_CONFIG_FILE, "utf-8"); } catch { return; }
      const newHash = crypto.createHash("md5").update(content).digest("hex");
      if (configHashes.get(HB_CONFIG_FILE) === newHash) return;
      configHashes.set(HB_CONFIG_FILE, newHash);
      log("🔄 hot-reload: heartbeat-config.json 已变更");
      reloadHeartbeat();
    });
    log("👁 监听配置目录变更");
  } catch (err) {
    logError(`fs.watch 启动失败: ${errorText(err)}`);
  }
}

export function startHeartbeat(callback: HeartbeatCallback) {
  onHeartbeat = callback;

  try {
    const content = fs.readFileSync(HB_CONFIG_FILE, "utf-8");
    configHashes.set(HB_CONFIG_FILE, crypto.createHash("md5").update(content).digest("hex"));
  } catch {}

  reloadHeartbeat();

  const scheduleMidnight = () => {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setDate(midnight.getDate() + 1);
    midnight.setHours(0, 0, 0, 0);
    const delayMs = midnight.getTime() - now.getTime();

    midnightTimer = setTimeout(() => {
      reloadHeartbeat();
      scheduleMidnight();
    }, delayMs);

    log(`💓 下次时间表生成: 明天 00:00（${Math.round(delayMs / 1000 / 60)} 分钟后）`);
  };

  scheduleMidnight();
  startConfigWatcher();
}
