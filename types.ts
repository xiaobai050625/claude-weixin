/**
 * Shared types and constants for the WeChat Channel plugin.
 */

// ── Account ──────────────────────────────────────────────────────────────────

export interface AccountData {
  token: string;
  baseUrl: string;
  accountId: string;
  userId?: string;
  savedAt: string;
}

// ── Allowlist ────────────────────────────────────────────────────────────────

export interface AllowEntry {
  id: string;
  nickname: string;
}

export interface Allowlist {
  allowed: AllowEntry[];
  auto_allow_next: boolean;
}

// ── Chat Log ─────────────────────────────────────────────────────────────────

export interface ChatLogEntry {
  ts: string;
  direction: "in" | "out";
  from: string;
  text: string;
  contentHash?: string;
  sentToClaude?: boolean;
}

export interface ChatState {
  lastByteOffset: number;
  lastHash: string;
  updatedAt: string;
}

// ── WeChat Message ───────────────────────────────────────────────────────────

export interface MediaInfo {
  encrypt_query_param?: string;
  aes_key?: string;
}

export interface TextItem {
  text?: string;
}

export interface RefMessage {
  message_item?: MessageItem;
  title?: string;
}

export interface MessageItem {
  type?: number;
  text_item?: TextItem;
  image_item?: { media?: MediaInfo; aeskey?: string };
  voice_item?: { media?: MediaInfo; text?: string };
  file_item?: { media?: MediaInfo; file_name?: string };
  video_item?: { media?: MediaInfo };
  ref_msg?: RefMessage;
}

export interface WeixinMessage {
  from_user_id?: string;
  to_user_id?: string;
  client_id?: string;
  session_id?: string;
  message_type?: number;
  message_state?: number;
  item_list?: MessageItem[];
  context_token?: string;
  create_time_ms?: number;
}

export interface GetUpdatesResp {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
}

export interface DownloadedMedia {
  type: "image" | "voice" | "file" | "video";
  filePath: string;
  fileName: string;
}

// ── Message Constants ────────────────────────────────────────────────────────

export const MSG_TYPE_USER = 1;
export const MSG_ITEM_TEXT = 1;
export const MSG_ITEM_VOICE = 3;
export const MSG_TYPE_BOT = 2;
export const MSG_STATE_FINISH = 2;

// Upload media types (different from message item types!)
export const UPLOAD_MEDIA_TYPE = { IMAGE: 1, VIDEO: 2, FILE: 3 } as const;

// ── Heartbeat ────────────────────────────────────────────────────────────────

export interface HBFixed {
  hour: number;
  minute: number;
  label?: string;
}

export interface HBConfig {
  fixed: HBFixed[];
  random: {
    active_start: number;
    active_end: number;
    daily_count: number;
    min_per_hour: number;
  };
}

export interface HBScheduleEntry {
  hour: number;
  minute: number;
  type: "fixed" | "random";
  label?: string;
}

// ── Window Manager ─────────────────────────────────────────────────────────────

export type WindowType = "visible" | "headless";
export type WindowSource = "wechat" | "local" | "agent";
export type WindowStatus = "starting" | "running" | "done" | "error" | "killed";

export interface WindowInfo {
  id: string;
  pid: number;
  type: WindowType;
  source: WindowSource;
  status: WindowStatus;
  label: string;
  startTime: string;
  endTime?: string;
}

// ── Hooks Events ───────────────────────────────────────────────────────────────

export interface HookEvent {
  event: string;
  window_id?: string;
  session_id?: string;
  transcript_path?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  cwd?: string;
  permission_kind?: string;
  timestamp: string;
}

export const SOURCE_EMOJI: Record<WindowSource, string> = {
  wechat: "📱",
  local: "🖥",
  agent: "🤖",
};

export const STATUS_LABEL: Record<WindowStatus, string> = {
  starting: "启动中",
  running: "运行中",
  done: "已完成",
  error: "出错",
  killed: "已终止",
};
