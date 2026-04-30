/**
 * Claude Code Hooks HTTP 处理器
 *
 * 接收 Claude Code 子进程的 hooks 回调，桥接到微信通知。
 */

import type http from "node:http";
import type { HookEvent } from "./types.js";
import { SOURCE_EMOJI, STATUS_LABEL } from "./types.js";
import { log, logError, errorText } from "./config.js";
import type { WindowInfo } from "./types.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HooksNotification {
  senderId: string;
  text: string;
}

export type HooksNotifyCallback = (notification: HooksNotification) => void;
let onNotify: HooksNotifyCallback | null = null;

export function setHooksNotifyCallback(cb: HooksNotifyCallback) {
  onNotify = cb;
}

// ── Window Lookup ─────────────────────────────────────────────────────────────

type WindowLookupFn = (id: string) => WindowInfo | undefined;
let lookupWindow: WindowLookupFn = () => undefined;

export function setWindowLookup(fn: WindowLookupFn) {
  lookupWindow = fn;
}

// ── JSON Body Parser ──────────────────────────────────────────────────────────

function jsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function jsonReply(res: http.ServerResponse, status: number, data: any) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

// ── Notification Builder ──────────────────────────────────────────────────────

function notifySenderId(win?: WindowInfo): string | null {
  // 返回窗口对应的 senderId（从微信来的窗口需要通知回同一个人）
  // 如果没有特定 sender，返回第一个白名单用户
  return null; // 由 daemon 的上层逻辑决定发给谁
}

function buildNotification(event: HookEvent, win?: WindowInfo): string | null {
  const emoji = win ? SOURCE_EMOJI[win.source] : "🤖";
  const label = win?.label ?? "未知窗口";

  switch (event.event) {
    case "subagent-stop":
      return `${emoji} 窗口「${label}」任务完成`;

    case "permission-request": {
      const kind = event.permission_kind ?? "未知操作";
      const tool = event.tool_name ?? "";
      const toolStr = tool ? `（工具: ${tool}）` : "";
      return `${emoji} 窗口「${label}」需要确认: ${kind}${toolStr}\n请回复 yes/no <id> 批准或拒绝`;
    }

    case "pre-tool-use": {
      const tool = event.tool_name ?? "未知工具";
      return `${emoji} 窗口「${label}」即将执行: ${tool}`;
    }

    case "window-error":
      return `⚠️ ${emoji} 窗口「${label}」出错退出`;

    case "window-done":
      return `${emoji} 窗口「${label}」已完成并退出`;

    default:
      return null;
  }
}

// ── Route Handler ─────────────────────────────────────────────────────────────

export async function handleHooksRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
): Promise<boolean> {
  if (!pathname.startsWith("/hooks/")) return false;

  const hookType = pathname.replace("/hooks/", "");

  try {
    const body = await jsonBody(req);
    const event: HookEvent = {
      event: hookType,
      window_id: body.window_id,
      session_id: body.session_id,
      transcript_path: body.transcript_path,
      tool_name: body.tool_name,
      tool_input: body.tool_input,
      cwd: body.cwd,
      permission_kind: body.permission_kind,
      timestamp: body.timestamp || new Date().toISOString(),
    };

    log(`Hooks 事件: ${hookType} (窗口: ${event.window_id ?? "?"})`);

    // 查找关联窗口
    const win = event.window_id ? lookupWindow(event.window_id) : undefined;

    // 生成通知文本
    const text = buildNotification(event, win);

    // 发送微信通知
    if (text && onNotify) {
      // 通知发给所有授权用户（由 daemon 决定）
      onNotify({ senderId: "", text });
    }

    jsonReply(res, 200, { status: "ok", hook: hookType });
    return true;
  } catch (err) {
    logError(`Hooks 处理异常: ${errorText(err)}`);
    jsonReply(res, 400, { error: "Bad request" });
    return true; // 路由已匹配，不要 fall through
  }
}
