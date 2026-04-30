/**
 * 子窗口进程管理器
 *
 * spawn 可见/无头 Claude 子进程、进程状态表、Windows 安全终止。
 */

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import crypto from "node:crypto";

import {
  WINDOW_SPAWN_DELAY_MS,
  MAX_WINDOWS,
  HOOKS_CONFIG_PATH,
  log,
  logError,
  errorText,
} from "./config.js";
import type { WindowInfo, WindowType, WindowSource, WindowStatus } from "./types.js";

// ── State ─────────────────────────────────────────────────────────────────────

const windows = new Map<string, WindowInfo>();
const processes = new Map<string, ChildProcess>();

export type WindowEventCallback = (event: string, win: WindowInfo) => void;
let onWindowEvent: WindowEventCallback | null = null;

export function setWindowEventCallback(cb: WindowEventCallback) {
  onWindowEvent = cb;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function wid(): string {
  return crypto.randomBytes(4).toString("hex"); // 8-char hex id
}

function nowISO(): string {
  return new Date().toISOString();
}

function emit(event: string, win: WindowInfo) {
  if (onWindowEvent) {
    try { onWindowEvent(event, win); } catch {}
  }
}

function updateStatus(id: string, status: WindowStatus) {
  const w = windows.get(id);
  if (!w) return;
  w.status = status;
  if (status === "done" || status === "error" || status === "killed") {
    w.endTime = nowISO();
  }
}

// ── Hooks Config Generator ────────────────────────────────────────────────────

function generateHooksConfig(windowId: string, daemonPort: number): string {
  const hooks = {
    SubagentStop: [{
      command: `curl -s -X POST http://127.0.0.1:${daemonPort}/hooks/subagent-stop -H "Content-Type: application/json" -d "{\\"window_id\\":\\"${windowId}\\",\\"timestamp\\":\\"$(date -Iseconds)\\"]}"`,
    }],
    PermissionRequest: [{
      command: `curl -s -X POST http://127.0.0.1:${daemonPort}/hooks/permission-request -H "Content-Type: application/json" -d "{\\"window_id\\":\\"${windowId}\\",\\"permission_kind\\":\\"$CLAUDE_PERMISSION_KIND\\",\\"tool_name\\":\\"$CLAUDE_TOOL_NAME\\",\\"timestamp\\":\\"$(date -Iseconds)\\"}"`,
    }],
    PreToolUse: [{
      command: `curl -s -X POST http://127.0.0.1:${daemonPort}/hooks/pre-tool-use -H "Content-Type: application/json" -d "{\\"window_id\\":\\"${windowId}\\",\\"tool_name\\":\\"$CLAUDE_TOOL_NAME\\",\\"timestamp\\":\\"$(date -Iseconds)\\"}"`,
    }],
  };

  const configPath = `${HOOKS_CONFIG_PATH}.${windowId}.json`;
  fs.writeFileSync(configPath, JSON.stringify(hooks, null, 2), "utf-8");
  log(`Hooks 配置已写入: ${configPath}`);
  return configPath;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * 启动一个 Claude 子窗口。
 *
 * @param type    "visible" → 桌面可见 cmd 窗口；"headless" → 后台静默
 * @param source  来源标记（📱微信 / 🖥本地 / 🤖Agent自主）
 * @param label   显示标签
 * @param daemonPort 守护进程端口（用于 hooks 回调）
 */
export async function spawnWindow(
  type: WindowType,
  source: WindowSource,
  label: string,
  daemonPort: number,
): Promise<WindowInfo | null> {
  // 窗口数上限检查
  const running = [...windows.values()].filter((w) => w.status === "running" || w.status === "starting");
  if (running.length >= MAX_WINDOWS) {
    logError(`窗口数已达上限 (${MAX_WINDOWS})，拒绝启动: ${label}`);
    return null;
  }

  const id = wid();
  const hooksConfigPath = generateHooksConfig(id, daemonPort);

  let child: ChildProcess;

  if (type === "visible") {
    // Windows: cmd /c start "title" claude 会弹出独立窗口
    // 用 cmd.exe /k 保持窗口可见，claude 启动后接管交互
    child = spawn("cmd.exe", [
      "/c", "start",
      `"Claude-${label.slice(0, 20)}"`,
      "claude",
      "--hooks-config", hooksConfigPath,
    ], {
      stdio: "ignore",
      detached: false,
      windowsHide: false,
    });
  } else {
    // 无头模式：后台 claude -p
    child = spawn("claude", [
      "-p",
      "--hooks-config", hooksConfigPath,
      "--output-format", "text",
    ], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
  }

  const pid = child.pid ?? 0;
  const now = nowISO();
  const win: WindowInfo = {
    id,
    pid,
    type,
    source,
    status: "starting",
    label,
    startTime: now,
  };

  windows.set(id, win);
  processes.set(id, child);

  // pid 延迟获取（spawn 可能还未返回 pid）
  if (pid === 0) {
    setTimeout(() => {
      if (child.pid) {
        win.pid = child.pid;
      }
    }, 500);
  }

  child.on("spawn", () => {
    win.status = "running";
    emit("window-started", win);
  });

  child.on("exit", (code) => {
    const ok = code === 0;
    updateStatus(id, ok ? "done" : "error");
    emit(ok ? "window-done" : "window-error", win);
    processes.delete(id);
    // 清理 hooks 配置
    try { fs.unlinkSync(hooksConfigPath); } catch {}
  });

  child.on("error", (err) => {
    updateStatus(id, "error");
    emit("window-error", win);
    logError(`窗口 ${label} 启动失败: ${errorText(err)}`);
    processes.delete(id);
  });

  log(`启动${type === "visible" ? "可见" : "后台"}窗口: ${label} (${id})`);
  emit("window-starting", win);

  return win;
}

/**
 * 终止子窗口（Windows 安全方式）。
 */
export function killWindow(id: string): boolean {
  const win = windows.get(id);
  if (!win) return false;

  if (win.status === "done" || win.status === "killed") return false;

  const child = processes.get(id);
  if (child && child.pid) {
    // Windows: 用 taskkill 替代 process.kill()
    spawn("taskkill", ["/F", "/PID", String(child.pid)], {
      stdio: "ignore",
      windowsHide: true,
    });
  }

  updateStatus(id, "killed");
  emit("window-killed", win);
  processes.delete(id);
  log(`终止窗口: ${win.label} (${id})`);
  return true;
}

/**
 * 列出所有窗口。
 */
export function listWindows(): WindowInfo[] {
  return [...windows.values()];
}

/**
 * 获取指定窗口。
 */
export function getWindow(id: string): WindowInfo | undefined {
  return windows.get(id);
}

/**
 * 向子窗口 stdin 注入指令。
 */
export function injectToWindow(id: string, text: string): boolean {
  const child = processes.get(id);
  if (!child || !child.stdin || child.stdin.destroyed) return false;

  try {
    child.stdin.write(text + "\n");
    log(`→ 注入窗口 ${id}: ${text.slice(0, 60)}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取正在运行的窗口数。
 */
export function runningCount(): number {
  return [...windows.values()].filter((w) => w.status === "running" || w.status === "starting").length;
}
