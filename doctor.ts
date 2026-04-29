/**
 * Claude-weixin 状态诊断
 */

import fs from "node:fs";
import path from "node:path";

function readJson(filePath: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

export function printDoctor(): void {
  const home = process.env.HOME || "~";
  const weixinDir = process.env.WEIXIN_DIR || path.join(home, ".claude", "weixin");
  const accountPath = path.join(weixinDir, "account.json");
  const allowlistPath = path.join(weixinDir, "allowlist.json");
  const mcpPath = path.join(process.cwd(), ".mcp.json");

  console.log("Claude-weixin doctor\n");

  const account = readJson(accountPath);
  if (account?.accountId) {
    console.log(`✓ 微信登录：已保存账号 ${account.accountId}`);
  } else {
    console.log("✗ 微信登录：还没完成，运行 2. 一键扫码登录.cmd");
  }

  const allowlist = readJson(allowlistPath);
  const allowed = Array.isArray(allowlist?.allowed) ? allowlist.allowed : [];
  if (allowed.length > 0) {
    console.log(`✓ 白名单：已有 ${allowed.length} 个用户`);
  } else if (allowlist?.auto_allow_next) {
    console.log("! 白名单：已开启自动添加，下一个发消息的人会被允许");
  } else {
    console.log("✗ 白名单：为空，运行 3. 一键开启白名单.cmd");
  }

  const mcp = readJson(mcpPath);
  if (mcp?.mcpServers?.weixin) {
    console.log("✓ MCP 配置：当前目录已配置 weixin");
  } else {
    console.log("✗ MCP 配置：当前目录还没安装，运行 4. 一键安装MCP配置.cmd");
  }

  console.log("\n启动命令：");
  console.log("  6. 一键启动守护进程.cmd");
}
