#!/usr/bin/env bun
/**
 * CLI entry point for source installs.
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
  // Generate .mcp.json in current directory
  // Find the package root (where package.json is)
  let pkgDir = path.dirname(new URL(import.meta.url).pathname);
  const srcServer = path.join(pkgDir, "wechat-channel.ts");

  const mcpConfig = {
    mcpServers: {
      wechat: {
        command: "bun",
        args: [srcServer],
      },
    },
  };

  // Write to .mcp.json in current directory
  const mcpJsonPath = path.join(process.cwd(), ".mcp.json");

  // Merge with existing if present
  let existing: any = {};
  try {
    existing = JSON.parse(fs.readFileSync(mcpJsonPath, "utf-8"));
  } catch {}

  if (!existing.mcpServers) existing.mcpServers = {};
  existing.mcpServers.wechat = mcpConfig.mcpServers.wechat;

  fs.writeFileSync(mcpJsonPath, JSON.stringify(existing, null, 2) + "\n", "utf-8");

  console.log(`✅ MCP 配置已写入 ${mcpJsonPath}`);
  console.log(`   server: ${srcServer}`);
  console.log(`   command: bun`);
  console.log();
  console.log("下一步：");
  console.log("  claude --dangerously-load-development-channels server:wechat");
} else if (cmd === "doctor") {
  printDoctor();
} else {
  console.log(`claude-code-wechat v0.4.0

Usage:
  bun cli.ts setup              扫码登录微信
  bun cli.ts install            生成 MCP 配置
  bun cli.ts doctor             检查本机配置状态
  bun cli.ts setup --allow-all  开启自动白名单
  bun cli.ts setup --allow ID   添加白名单
  bun cli.ts setup --list       查看白名单

启动 Channel:
  claude --dangerously-load-development-channels server:wechat

详细文档: https://github.com/LinekForge/claude-code-wechat`);
}

export {};
