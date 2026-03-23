/**
 * ilink API: WeChat ClawBot HTTP interface (ilinkai.weixin.qq.com).
 */

import crypto from "node:crypto";
import fs from "node:fs";

import { CRED_FILE, CHANNEL_VERSION, LONG_POLL_TIMEOUT_MS } from "./config.js";
import type { AccountData, GetUpdatesResp } from "./types.js";
import { MSG_TYPE_BOT, MSG_STATE_FINISH, MSG_ITEM_TEXT } from "./types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Generate a random X-WECHAT-UIN header value. ilink API requires this per-request anti-replay token. */
export function randomWechatUin(): string {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), "utf-8").toString("base64");
}

export function buildHeaders(token?: string, body?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": randomWechatUin(),
  };
  if (body) {
    headers["Content-Length"] = String(Buffer.byteLength(body, "utf-8"));
  }
  if (token?.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }
  return headers;
}

// ── Generic fetch ────────────────────────────────────────────────────────────

export async function apiFetch(params: {
  baseUrl: string;
  endpoint: string;
  body: string;
  token?: string;
  timeoutMs: number;
}): Promise<{ text: string; status: number }> {
  const base = params.baseUrl.endsWith("/")
    ? params.baseUrl
    : `${params.baseUrl}/`;
  const url = new URL(params.endpoint, base).toString();
  const headers = buildHeaders(params.token, params.body);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: params.body,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
    return { text, status: res.status };
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ── Credentials ──────────────────────────────────────────────────────────────

export function loadCredentials(): AccountData | null {
  try {
    if (!fs.existsSync(CRED_FILE)) return null;
    return JSON.parse(fs.readFileSync(CRED_FILE, "utf-8"));
  } catch {
    return null;
  }
}

// ── getUpdates / sendText ────────────────────────────────────────────────────

export async function getUpdates(
  baseUrl: string,
  token: string,
  syncBuf: string,
): Promise<GetUpdatesResp> {
  try {
    const result = await apiFetch({
      baseUrl,
      endpoint: "ilink/bot/getupdates",
      body: JSON.stringify({
        get_updates_buf: syncBuf,
        base_info: { channel_version: CHANNEL_VERSION },
      }),
      token,
      timeoutMs: LONG_POLL_TIMEOUT_MS,
    });
    return JSON.parse(result.text) as GetUpdatesResp;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ret: 0, msgs: [], get_updates_buf: syncBuf };
    }
    throw err;
  }
}

export function generateClientId(): string {
  return `wechat-channel:${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

export async function sendText(
  baseUrl: string,
  token: string,
  to: string,
  text: string,
  contextToken: string,
): Promise<void> {
  await apiFetch({
    baseUrl,
    endpoint: "ilink/bot/sendmessage",
    body: JSON.stringify({
      msg: {
        from_user_id: "",
        to_user_id: to,
        client_id: generateClientId(),
        message_type: MSG_TYPE_BOT,
        message_state: MSG_STATE_FINISH,
        item_list: [{ type: MSG_ITEM_TEXT, text_item: { text } }],
        context_token: contextToken,
      },
      base_info: { channel_version: CHANNEL_VERSION },
    }),
    token,
    timeoutMs: 15_000,
  });
}
