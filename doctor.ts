/**
 * Local setup diagnostics for claude-code-wechat.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function readJson(filePath: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function commandExists(command: string): boolean {
  try {
    execFileSync("/usr/bin/env", ["which", command], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function printDoctor(): void {
  const home = process.env.HOME || "~";
  const repoCli = "bun /absolute/path/to/claude-code-wechat/cli.ts";
  const channelDir = process.env.WECHAT_CHANNEL_DIR || path.join(home, ".claude", "channels", "wechat");
  const accountPath = path.join(channelDir, "account.json");
  const allowlistPath = path.join(channelDir, "allowlist.json");
  const mcpPath = path.join(process.cwd(), ".mcp.json");
  const voiceScript = path.join(home, ".claude", "scripts", "minimax-voice.sh");

  console.log("claude-code-wechat doctor\n");

  const account = readJson(accountPath);
  if (account?.accountId) {
    console.log(`✓ 微信登录：已保存账号 ${account.accountId}`);
  } else {
    console.log(`✗ 微信登录：还没完成，请在仓库目录运行 bun cli.ts setup`);
  }

  const allowlist = readJson(allowlistPath);
  const allowed = Array.isArray(allowlist?.allowed) ? allowlist.allowed : [];
  if (allowed.length > 0) {
    console.log(`✓ 白名单：已有 ${allowed.length} 个用户`);
  } else if (allowlist?.auto_allow_next) {
    console.log("! 白名单：已开启自动添加，下一个发消息的人会被允许");
  } else {
    console.log("✗ 白名单：为空，请在仓库目录运行 bun cli.ts setup --allow-all，然后从微信发一条消息");
  }

  const mcp = readJson(mcpPath);
  if (mcp?.mcpServers?.wechat) {
    console.log("✓ Claude 配置：当前目录已配置 wechat");
  } else {
    console.log(`✗ Claude 配置：当前目录还没安装，请在目标项目目录运行 ${repoCli} install`);
  }

  if (commandExists("ffmpeg") && commandExists("ffprobe")) {
    console.log("✓ 视频处理：ffmpeg/ffprobe 可用");
  } else {
    console.log("! 视频处理：ffmpeg/ffprobe 未安装，视频抽帧会跳过");
  }

  if (fs.existsSync(voiceScript)) {
    console.log("✓ 语音发送：TTS 脚本已配置");
  } else {
    console.log("! 语音发送：TTS 脚本未配置，不影响文字/图片/文件");
  }

  console.log("\n启动命令：");
  console.log("  claude --dangerously-load-development-channels server:wechat");
}
