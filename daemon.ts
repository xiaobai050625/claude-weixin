#!/usr/bin/env bun
/**
 * Claude-weixin 守护进程
 *
 * 独立运行，不依赖 Claude Code Channels 协议。
 * - HTTP 服务 (MCP 适配器桥接)
 * - iLink 长轮询 (微信消息收发)
 * - Claude Code CLI 调度 (模型无关)
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import type { AccountData } from "./types.js";
import { MSG_TYPE_USER } from "./types.js";

import {
  CHANNEL_NAME,
  CHANNEL_VERSION,
  DIR,
  SYNC_FILE,
  MEDIA_DIR,
  MAX_CONSECUTIVE_FAILURES,
  BACKOFF_DELAY_MS,
  RETRY_DELAY_MS,
  REPLAY_MAX,
  errorText,
  log,
  logError,
} from "./config.js";

import { loadAllowlist, isAllowed, getNickname } from "./allowlist.js";
import { loadCredentials, getUpdates, sendText } from "./ilink-api.js";
import { uploadAndSendMedia, extractContent } from "./media.js";
import {
  contextTokens,
  loadContextTokens,
  saveContextTokens,
  appendChatLog,
  loadUnsynchronizedChatLog,
  markChatLogSent,
} from "./chat-log.js";
import { reloadHeartbeat, startHeartbeat } from "./heartbeat.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.WEIXIN_DAEMON_PORT || "18923", 10);
const MCP_CONFIG_PATH = path.join(DIR, "weixin-mcp.json");
const MCP_ADAPTER_PATH = path.join(path.dirname(new URL(import.meta.url).pathname), "mcp-adapter.ts");

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;
const outboundTimestamps: number[] = [];

// ── State ─────────────────────────────────────────────────────────────────────

let account: AccountData | null = null;
let lastReplySent = false;

interface QueuedMessage {
  senderId: string;
  nickname: string;
  text: string;
  contextToken: string;
}

const messageQueue: QueuedMessage[] = [];
let processing = false;

// ── Rate Limiter ──────────────────────────────────────────────────────────────

function checkRateLimit(): boolean {
  const now = Date.now();
  while (outboundTimestamps.length > 0 && outboundTimestamps[0] < now - RATE_LIMIT_WINDOW_MS) {
    outboundTimestamps.shift();
  }
  if (outboundTimestamps.length >= RATE_LIMIT_MAX) {
    logError(`出站消息速率限制：${RATE_LIMIT_MAX} 条/分钟`);
    return false;
  }
  outboundTimestamps.push(now);
  return true;
}

// ── Prompt Builder ─────────────────────────────────────────────────────────────

function buildPrompt(msg: QueuedMessage): string {
  return `[微信消息] 来自 ${msg.nickname}（sender_id: ${msg.senderId}）

${msg.text}

请处理这条微信消息。
- 用中文回复，保持简洁自然（微信是聊天场景）。
- 回复时调用 wechat_reply 工具，sender_id 参数值为 "${msg.senderId}"。
- 需要发送文件时调用 wechat_send_file 工具。
- 不要输出 markdown，微信不渲染。`;
}

function buildHistoryReplayPrompt(entries: { from: string; text: string; ts: string }[]): string {
  const fmt = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const lines = entries.map((e) => {
    const d = new Date(e.ts);
    const parts = fmt.formatToParts(d);
    const get = (t: string) => parts.find(p => p.type === t)?.value ?? '00';
    return `[${get('month')}-${get('day')} ${get('hour')}:${get('minute')}] ${e.from}: ${e.text}`;
  });
  return `[系统] 以下是之前的微信对话记录，仅用于恢复上下文，不要回复这些历史内容。等待新的消息。

${lines.join("\n")}

[系统] 以上是历史记录，现在开始处理新消息。`;
}

// ── Claude Process Manager ─────────────────────────────────────────────────────

async function runClaude(msg: QueuedMessage): Promise<string | null> {
  lastReplySent = false;

  // 增量加载：只取上次上传后新增的消息，不重复传历史
  const recentEntries = loadUnsynchronizedChatLog(REPLAY_MAX);

  let prompt: string;
  if (recentEntries.length > 0) {
    const historyPrompt = buildHistoryReplayPrompt(
      recentEntries.map((e) => ({
        from: e.direction === "in" ? e.from : "Claude",
        text: e.text,
        ts: e.ts,
      }))
    );
    prompt = historyPrompt + "\n\n" + buildPrompt(msg);
    log(`附加上下文: ${recentEntries.length} 条历史记录`);
  } else {
    prompt = buildPrompt(msg);
  }

  log("启动 Claude...");

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";

    const child = spawn("claude", [
      "-p", prompt,
      "--mcp-config", MCP_CONFIG_PATH,
      "--output-format", "text",
    ], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
      cwd: process.cwd(),
    });

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code: number | null) => {
      log(`Claude 进程退出: code=${code}`);
      if (stderr) {
        // Filter out known non-error stderr messages
        const errors = stderr.split("\n").filter(l => l.trim() && !l.includes("MCP") && !l.includes("DEBUG"));
        if (errors.length > 0) {
          logError(`Claude stderr: ${errors.slice(0, 3).join(" | ")}`);
        }
      }

      const text = stdout.trim();
      if (!lastReplySent && text) {
        // Claude didn't call wechat_reply, use stdout as reply
        resolve(text);
      } else if (lastReplySent) {
        resolve(null); // Already replied via MCP tool
      } else {
        resolve(null);
      }
    });

    child.on("error", (err: Error) => {
      logError(`启动 Claude 失败: ${errorText(err)}`);
      resolve(null);
    });
  });
}

async function processQueue(): Promise<void> {
  if (processing || messageQueue.length === 0) return;
  if (!account) return;

  processing = true;

  while (messageQueue.length > 0) {
    const msg = messageQueue.shift()!;

    try {
      const response = await runClaude(msg);

      // 标记本轮上下文已上传，下次不再重复发送
      markChatLogSent();

      if (response) {
        // Send Claude's stdout as reply
        const ctxToken = contextTokens.get(msg.senderId);
        if (ctxToken && checkRateLimit()) {
          // Truncate very long responses for WeChat
          const truncated = response.length > 3000
            ? response.slice(0, 3000) + "\n\n[回复过长，已截断。完整内容见终端。]"
            : response;

          await sendText(account.baseUrl, account.token, msg.senderId, truncated, ctxToken);
          const nick = getNickname(msg.senderId);
          log(`→ 回复 ${nick}: ${truncated.slice(0, 80)}...`);
          appendChatLog({
            ts: new Date().toISOString(),
            direction: "out",
            from: "Claude",
            text: truncated,
          });
        }
      }
    } catch (err) {
      logError(`消息处理异常: ${errorText(err)}`);
    }
  }

  processing = false;
}

// ── HTTP Server (MCP 适配器桥接) ──────────────────────────────────────────────

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

async function handleReply(sender_id: string, text: string): Promise<{ success: boolean; error?: string }> {
  if (!account) return { success: false, error: "未登录微信" };

  const ctxToken = contextTokens.get(sender_id);
  if (!ctxToken) {
    return { success: false, error: `缺少 ${sender_id} 的 context_token。请先让该用户发一条消息。` };
  }

  if (!checkRateLimit()) {
    return { success: false, error: "发送速率限制" };
  }

  try {
    await sendText(account.baseUrl, account.token, sender_id, text, ctxToken);
    const nick = getNickname(sender_id);
    log(`→ MCP 回复 ${nick}: ${text.slice(0, 80)}`);
    appendChatLog({
      ts: new Date().toISOString(),
      direction: "out",
      from: "Claude",
      text,
    });
    lastReplySent = true;
    return { success: true };
  } catch (err) {
    return { success: false, error: errorText(err) };
  }
}

async function handleSendFile(sender_id: string, file_path_or_url: string): Promise<{ success: boolean; error?: string }> {
  if (!account) return { success: false, error: "未登录微信" };

  const ctxToken = contextTokens.get(sender_id);
  if (!ctxToken) {
    return { success: false, error: `缺少 ${sender_id} 的 context_token` };
  }

  if (!checkRateLimit()) {
    return { success: false, error: "发送速率限制" };
  }

  try {
    let localPath = file_path_or_url;

    // URL support: download first
    if (file_path_or_url.startsWith("http://") || file_path_or_url.startsWith("https://")) {
      log(`下载远程文件: ${file_path_or_url.slice(0, 80)}...`);
      const dlController = new AbortController();
      const dlTimer = setTimeout(() => dlController.abort(), 30_000);
      try {
        const res = await fetch(file_path_or_url, { signal: dlController.signal });
        clearTimeout(dlTimer);
        if (!res.ok) throw new Error(`下载失败: HTTP ${res.status}`);
        const contentLength = parseInt(res.headers.get("content-length") || "0", 10);
        if (contentLength > 100 * 1024 * 1024) {
          throw new Error(`文件过大: ${contentLength} bytes (上限 100MB)`);
        }
        const ext = path.extname(new URL(file_path_or_url).pathname) || ".bin";
        const tempPath = path.join(MEDIA_DIR, `dl_${Date.now()}${ext}`);
        const buf = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(tempPath, buf);
        localPath = tempPath;
        log(`下载完成: ${buf.length} bytes → ${tempPath}`);
      } catch (err) {
        clearTimeout(dlTimer);
        throw err;
      }
    }

    if (!fs.existsSync(localPath)) {
      return { success: false, error: `文件不存在：${localPath}` };
    }

    await uploadAndSendMedia(account.baseUrl, account.token, sender_id, localPath, ctxToken);
    const displayName = path.basename(localPath);
    log(`→ MCP 发送文件给 ${getNickname(sender_id)}: ${displayName}`);
    appendChatLog({
      ts: new Date().toISOString(),
      direction: "out",
      from: "Claude",
      text: `[发送文件] ${displayName}`,
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: errorText(err) };
  }
}

function handleReloadHeartbeat(): { success: boolean; count: number } {
  try {
    const count = reloadHeartbeat();
    return { success: true, count };
  } catch (err) {
    return { success: false, count: 0 };
  }
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  // CORS for local development
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://localhost:${PORT}`);

  try {
    if (req.method === "GET" && url.pathname === "/api/ping") {
      jsonReply(res, 200, { status: "ok", loggedIn: !!account });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/reply") {
      const body = await jsonBody(req);
      const result = await handleReply(body.sender_id, body.text);
      jsonReply(res, result.success ? 200 : 400, {
        content: [{ type: "text", text: result.success ? "sent" : result.error }],
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/send-file") {
      const body = await jsonBody(req);
      const result = await handleSendFile(body.sender_id, body.file_path_or_url);
      jsonReply(res, result.success ? 200 : 400, {
        content: [{ type: "text", text: result.success ? "sent" : result.error }],
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/reload-heartbeat") {
      const result = handleReloadHeartbeat();
      jsonReply(res, result.success ? 200 : 400, {
        content: [{ type: "text", text: result.success ? `heartbeat reloaded: ${result.count} entries` : "heartbeat 重载失败" }],
      });
      return;
    }

    jsonReply(res, 404, { error: "Not found" });
  } catch (err) {
    logError(`HTTP 处理异常: ${errorText(err)}`);
    jsonReply(res, 500, { error: "Internal server error" });
  }
}

// ── iLink Long-Poll Loop ──────────────────────────────────────────────────────

const PERMISSION_REPLY_RE = /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i;

async function startPolling(acct: AccountData): Promise<never> {
  const { baseUrl, token } = acct;
  let syncBuf = "";
  let consecutiveFailures = 0;

  try {
    if (fs.existsSync(SYNC_FILE)) {
      syncBuf = fs.readFileSync(SYNC_FILE, "utf-8");
      log(`恢复同步状态 (${syncBuf.length} bytes)`);
    }
  } catch {}

  loadContextTokens();
  log("开始监听微信消息...");

  while (true) {
    try {
      const resp = await getUpdates(baseUrl, token, syncBuf);

      const isError =
        (resp.ret !== undefined && resp.ret !== 0) ||
        (resp.errcode !== undefined && resp.errcode !== 0);

      if (isError) {
        consecutiveFailures++;
        const errMsg = resp.errmsg ?? "";

        if (errMsg.includes("token") || errMsg.includes("auth") || resp.errcode === 401) {
          logError("bot_token 可能已过期。运行 bun daemon.ts --setup 重新扫码。");
        }

        logError(`getupdates 失败: ret=${resp.ret} errcode=${resp.errcode} errmsg=${errMsg}`);
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          logError(`连续失败 ${MAX_CONSECUTIVE_FAILURES} 次，等待 ${BACKOFF_DELAY_MS / 1000}s`);
          consecutiveFailures = 0;
          await new Promise((r) => setTimeout(r, BACKOFF_DELAY_MS));
        } else {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        }
        continue;
      }

      consecutiveFailures = 0;

      if (resp.get_updates_buf) {
        syncBuf = resp.get_updates_buf;
        try { fs.writeFileSync(SYNC_FILE, syncBuf, "utf-8"); } catch {}
      }

      for (const msg of resp.msgs ?? []) {
        if (msg.message_type !== MSG_TYPE_USER) continue;

        const text = await extractContent(msg);
        if (!text) {
          try {
            const entry = { ts: new Date().toISOString(), type: "empty_content", message_type: msg.message_type, items: msg.item_list };
            fs.appendFileSync(path.join(DIR, "unhandled.jsonl"), JSON.stringify(entry) + "\n", "utf-8");
          } catch {}
          continue;
        }

        const senderId = msg.from_user_id ?? "unknown";

        if (msg.context_token) {
          contextTokens.set(senderId, msg.context_token);
          saveContextTokens();
        }

        if (!isAllowed(senderId)) {
          log(`拒绝未授权 sender: ${senderId} (消息: ${text.slice(0, 30)}...)`);
          log(`  运行 bun cli.ts setup --allow ${senderId} 添加授权`);
          continue;
        }

        const nick = getNickname(senderId);

        // Permission reply detection (compatibility with old format)
        const permMatch = PERMISSION_REPLY_RE.exec(text);
        if (permMatch) {
          const behavior = permMatch[1].toLowerCase().startsWith("y") ? "allow" : "deny";
          log(`权限${behavior === "allow" ? "批准" : "拒绝"}: ${permMatch[2]}`);
          appendChatLog({
            ts: new Date().toISOString(),
            direction: "in",
            from: nick,
            text: `[权限${behavior === "allow" ? "批准" : "拒绝"}] ${permMatch[2]}`,
          });
          // Permission approval is sent as a regular reply via wechat_reply
          // since we no longer have the Channels protocol for permission relay
          messageQueue.push({
            senderId,
            nickname: nick,
            text: `[权限响应] 用户${behavior === "allow" ? "批准" : "拒绝"}了请求 ${permMatch[2]}。请继续之前的工作。`,
            contextToken: msg.context_token || contextTokens.get(senderId) || "",
          });
          processQueue();
          continue;
        }

        log(`← ${nick}: ${text.slice(0, 80)}${text.length > 80 ? "..." : ""}`);

        appendChatLog({
          ts: new Date().toISOString(),
          direction: "in",
          from: nick,
          text,
        });

        messageQueue.push({
          senderId,
          nickname: nick,
          text,
          contextToken: msg.context_token || "",
        });

        processQueue();
      }
    } catch (err) {
      consecutiveFailures++;
      logError(`轮询异常: ${errorText(err)}`);
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        consecutiveFailures = 0;
        await new Promise((r) => setTimeout(r, BACKOFF_DELAY_MS));
      } else {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  }
}

// ── MCP Config Generator ──────────────────────────────────────────────────────

function generateMcpConfig() {
  const config = {
    mcpServers: {
      weixin: {
        command: "bun",
        args: [MCP_ADAPTER_PATH],
        env: {
          WEIXIN_DAEMON_PORT: String(PORT),
        },
      },
    },
  };
  fs.writeFileSync(MCP_CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
  log(`MCP 配置已写入: ${MCP_CONFIG_PATH}`);
}

// ── Heartbeat (modified for CLI mode) ─────────────────────────────────────────

function setupHeartbeat() {
  // Heartbeat now schedules Claude -p invocations instead of channel notifications
  startHeartbeat((senderId: string, nickname: string, timeStr: string, label: string) => {
    const labelStr = label ? `（${label}）` : "";
    messageQueue.push({
      senderId,
      nickname,
      text: `现在是 ${timeStr}${labelStr}。根据时间段给用户发一条自然的微信消息，不要机械化。如果之前和用户在聊天，不需要因为 heartbeat 额外发消息。`,
      contextToken: contextTokens.get(senderId) || "",
    });
    processQueue();
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  process.on("unhandledRejection", (reason) => {
    logError(`Unhandled rejection: ${errorText(reason)}`);
  });

  // Ensure directories
  try { fs.mkdirSync(MEDIA_DIR, { recursive: true }); } catch {}

  // Load credentials
  const creds = loadCredentials();
  if (!creds) {
    logError("未找到微信登录信息。运行 bun cli.ts setup 扫码登录。");
    process.exit(1);
  }
  account = creds;
  log(`账号: ${creds.accountId}`);

  // Print allowlist
  const list = loadAllowlist();
  if (list.allowed.length === 0 && !list.auto_allow_next) {
    log("allowlist 为空。运行 bun cli.ts setup --allow-all 开启自动添加");
  } else {
    for (const entry of list.allowed) {
      log(`  允许: ${entry.nickname} (${entry.id})`);
    }
  }

  // Generate MCP config for Claude -p mode
  generateMcpConfig();

  // Start HTTP server for MCP adapter
  const server = http.createServer(handleRequest);
  server.listen(PORT, "127.0.0.1", () => {
    log(`HTTP 服务已启动: http://127.0.0.1:${PORT}`);
  });

  // Setup heartbeat
  setupHeartbeat();

  // Start polling (never returns)
  await startPolling(creds);
}

main().catch((err) => {
  logError(`Fatal: ${errorText(err)}`);
  process.exit(1);
});
