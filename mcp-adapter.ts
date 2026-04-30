#!/usr/bin/env bun
/**
 * Claude-weixin MCP 适配器
 *
 * Claude Code 通过 stdio 启动此进程，此进程将 MCP 工具调用
 * 转发到本地守护进程的 HTTP API。
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const PORT = process.env.WEIXIN_DAEMON_PORT || "18923";
const DAEMON_URL = `http://127.0.0.1:${PORT}`;

// ── MCP Server ────────────────────────────────────────────────────────────────

const server = new Server(
  { name: "weixin", version: "1.0.0" },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "wechat_reply",
      description: "发送文本回复到微信用户。用纯文本，不要用 markdown。",
      inputSchema: {
        type: "object" as const,
        properties: {
          sender_id: {
            type: "string",
            description: "消息中提供的 sender_id（xxx@im.wechat 格式）",
          },
          text: {
            type: "string",
            description: "要发送的纯文本消息",
          },
        },
        required: ["sender_id", "text"],
      },
    },
    {
      name: "wechat_send_file",
      description: "发送文件、图片或视频到微信。支持本地路径和 HTTPS URL。",
      inputSchema: {
        type: "object" as const,
        properties: {
          sender_id: {
            type: "string",
            description: "消息中提供的 sender_id",
          },
          file_path_or_url: {
            type: "string",
            description: "本地文件绝对路径或 HTTPS URL",
          },
        },
        required: ["sender_id", "file_path_or_url"],
      },
    },
    {
      name: "wechat_reload_heartbeat",
      description: "重新加载 heartbeat 配置并重新生成今日时间表。",
      inputSchema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: "window_spawn",
      description: "启动一个 Claude Code 子窗口。visible 类型会在桌面弹出可见窗口，headless 在后台静默运行。",
      inputSchema: {
        type: "object" as const,
        properties: {
          type: {
            type: "string",
            description: "窗口类型：visible（桌面可见）或 headless（后台静默）",
          },
          label: {
            type: "string",
            description: "窗口标签，方便识别",
          },
          source: {
            type: "string",
            description: "来源标记：wechat / local / agent",
          },
        },
        required: ["type", "label"],
      },
    },
    {
      name: "window_list",
      description: "列出当前所有子窗口及其状态。",
      inputSchema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: "window_kill",
      description: "终止指定子窗口。",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: {
            type: "string",
            description: "窗口 ID（从 window_list 获取）",
          },
        },
        required: ["id"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const endpointMap: Record<string, string> = {
    wechat_reply: "/api/reply",
    wechat_send_file: "/api/send-file",
    wechat_reload_heartbeat: "/api/reload-heartbeat",
    window_spawn: "/api/window-spawn",
    window_list: "/api/window-list",
    window_kill: "/api/window-kill",
  };

  const endpoint = endpointMap[req.params.name];
  if (!endpoint) {
    throw new Error(`未知工具：${req.params.name}`);
  }

  try {
    const res = await fetch(`${DAEMON_URL}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.params.arguments),
    });

    if (!res.ok) {
      const errBody = await res.text();
      return {
        content: [{ type: "text" as const, text: `发送失败：${errBody}` }],
      };
    }

    const data = await res.json();
    return data;
  } catch (err) {
    return {
      content: [{
        type: "text" as const,
        text: `无法连接到微信守护进程 (${DAEMON_URL})。请确认 daemon.ts 正在运行。`,
      }],
    };
  }
});

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`[weixin-mcp] Fatal: ${err}\n`);
  process.exit(1);
});
