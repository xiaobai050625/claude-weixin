#!/usr/bin/env bun
/**
 * Claude-weixin CLI
 *
 * Usage:
 *   bun cli.ts setup               扫码登录微信
 *   bun cli.ts install             生成 MCP 配置
 *   bun cli.ts doctor              检查本机配置状态
 *   bun cli.ts setup --allow-all   开启自动白名单
 *   bun cli.ts setup --allow ID    添加白名单
 *   bun cli.ts setup --list        查看白名单
 *
 * 启动守护进程:
 *   bun daemon.ts
 */

import fs from "node:fs";
import path from "node:path";
import { printDoctor } from "./doctor.js";

const args = process.argv.slice(2);
const cmd = args[0];

if (cmd === "setup") {
  process.argv = [process.argv[0], "setup.ts", ...args.slice(1)];
  await import("./setup.js");
} else if (cmd === "install") {
  const pkgDir = path.dirname(new URL(import.meta.url).pathname);

  // 生成 .mcp.json (Claude Code 在 -p 模式下加载 MCP 配置)
  const mcpConfig = {
    mcpServers: {
      weixin: {
        command: "bun",
        args: [path.join(pkgDir, "mcp-adapter.ts")],
        env: {
          WEIXIN_DAEMON_PORT: process.env.WEIXIN_DAEMON_PORT || "18923",
        },
      },
    },
  };

  const mcpJsonPath = path.join(process.cwd(), ".mcp.json");

  let existing: any = {};
  try {
    existing = JSON.parse(fs.readFileSync(mcpJsonPath, "utf-8"));
  } catch {}

  if (!existing.mcpServers) existing.mcpServers = {};
  existing.mcpServers.weixin = mcpConfig.mcpServers.weixin;

  fs.writeFileSync(mcpJsonPath, JSON.stringify(existing, null, 2) + "\n", "utf-8");

  console.log(`✅ MCP 配置已写入 ${mcpJsonPath}`);
  console.log();
  console.log("下一步：");
  console.log("  1. bun daemon.ts                 启动守护进程（开始监听微信消息）");
  console.log("  2. bun cli.ts doctor             检查状态");
} else if (cmd === "doctor") {
  printDoctor();
} else {
  console.log(`Claude-weixin v1.0.0

微信 ↔ Claude Code 桥接 — 模型无关

Usage:
  bun cli.ts setup               扫码登录微信
  bun cli.ts setup --allow-all   开启自动白名单（调试用）
  bun cli.ts setup --allow ID [昵称]  添加白名单
  bun cli.ts setup --list        查看白名单
  bun cli.ts install             在项目目录生成 MCP 配置
  bun cli.ts doctor              检查配置状态

启动:
  bun daemon.ts                  启动守护进程`);
}

export {};
