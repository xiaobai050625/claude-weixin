# Claude Code WeChat (claude-weixin)

用微信远程指挥 Claude Code。

你可以在微信里发消息，让电脑上的 Claude Code 继续改项目、回传结果、发送文件；遇到需要权限的操作时，也可以直接在微信里批准或拒绝。

- **消息** — 文字、图片、文件、视频、语音、引用，全支持
- **审批** — 不在电脑前？微信远程批准 Claude 的操作
- **心跳** — 每天定时发消息，时间随机，正在聊天时不打扰
- **记忆** — 重启自动回放最近 200 条对话，标注上下文
- **安全** — 白名单门控，未授权消息静默丢弃

## 适合谁

适合已经在用 Claude Code、但不想一直守在电脑前的人。

比如：

- 出门在外，用微信让 Claude Code 继续改项目
- Claude Code 需要权限时，直接在微信里批准或拒绝
- 临时想到一个需求，先发到微信，让电脑上的 Claude Code 接着干
- 睡前或路上查看进度，不用打开终端

## 它怎么工作

```text
微信 → ClawBot → claude-weixin → Claude Code
微信 ← ClawBot ← claude-weixin ← Claude Code
```

基于微信官方 ClawBot ilink API，独立守护进程模式，不依赖 Claude Code Channels 协议。不逆向，不模拟协议。

## 前置要求

- [Bun](https://bun.sh) >= 1.0
- [Claude Code](https://code.claude.com)（需 claude.ai 账号登录，不支持 API key）
- 微信 iOS 最新版（需支持 ClawBot 插件）

## 快速开始

目标：让你在微信里发一句话，Claude Code 能收到并回复。

**1. 获取源码 & 安装依赖**

```bash
git clone https://github.com/xiaobai050625/claude-weixin.git
cd claude-weixin
```

双击 `1. 一键安装依赖.cmd`。

**2. 扫码登录**

双击 `2. 一键扫码登录.cmd` 或运行：

```bash
bun cli.ts setup
```

这一步需要你用微信扫描终端里的二维码，并在微信里确认。

**3. 开启白名单**

双击 `3. 一键开启白名单.cmd`，下一个从微信发消息的人会自动加入白名单。

**4. 安装 MCP 配置**

双击 `4. 一键安装MCP配置.cmd` 或在目标项目目录运行：

```bash
bun /path/to/claude-weixin/cli.ts install
```

**5. 检查状态**

双击 `5. 一键状态检查.cmd` 或运行：

```bash
bun cli.ts doctor
```

**6. 启动守护进程**

双击 `6. 一键启动守护进程.cmd` 或运行：

```bash
bun daemon.ts
```

**7. 第一次测试**

打开微信，找到 ClawBot，发一条：

```text
你好，收到吗？
```

如果 Claude Code 回复到了微信，说明连接成功。

## 一键脚本

| 脚本 | 功能 |
|------|------|
| `1. 一键安装依赖.cmd` | 安装项目依赖（新设备第一步） |
| `2. 一键扫码登录.cmd` | 扫码登录微信 |
| `3. 一键开启白名单.cmd` | 开启自动添加白名单模式 |
| `4. 一键安装MCP配置.cmd` | 在当前目录生成 MCP 连接配置 |
| `5. 一键状态检查.cmd` | 检查登录、白名单、MCP 配置状态 |
| `6. 一键启动守护进程.cmd` | 启动后台服务，监听微信消息 |

## 日常使用

你可以像这样在微信里发：

```text
帮我看看项目的最近问题，修好后跑一下测试。
```

Claude Code 会在电脑上继续工作。需要权限时，它会把审批请求发到微信；回复 `yes <id>` 或 `no <id>` 即可。

<details>
<summary>白名单管理</summary>

首次使用时，第一个发消息的人自动加入白名单。也可以手动管理：

```bash
bun cli.ts setup --allow <id> <昵称>
bun cli.ts setup --list
```
</details>

## 项目结构

```
daemon.ts          ← 主入口：守护进程，HTTP 服务 + iLink 轮询
mcp-adapter.ts     ← MCP 适配器：Claude Code 调用 MCP 工具时的桥接
├── types.ts       ← 接口和常量
├── config.ts      ← 路径、CDN、超时、日志
├── allowlist.ts   ← 白名单管理
├── ilink-api.ts   ← ilink HTTP 调用层
├── media.ts       ← 媒体加解密、CDN 上传下载
├── chat-log.ts    ← 聊天记录持久化和回放
└── heartbeat.ts   ← 心跳调度和热加载

cli.ts             ← CLI 入口：setup / install / doctor
setup.ts           ← 微信扫码登录 + 白名单管理
doctor.ts          ← 状态诊断
```

## 媒体支持

**接收（微信 → Claude）**

| 类型 | 处理方式 |
|------|---------|
| 文字 | 直接转发 |
| 图片 | CDN 下载 + AES 解密，Claude 可查看 |
| 文件 | CDN 下载 + AES 解密，Claude 可读取 |
| 视频 | CDN 下载保存，Claude 无法原生播放 |
| 语音 | 微信 ASR 自动转文字 |
| 引用 | 显示被引用的原文 |

**发送（Claude → 微信）**

| 类型 | 使用方式 |
|------|---------|
| 文字 | `wechat_reply` 工具 |
| 图片/文件/视频 | `wechat_send_file` 工具，支持本地路径和 HTTPS URL |

## 工具

| 工具 | 做什么 |
|------|--------|
| `wechat_reply` | 发文字到微信 |
| `wechat_send_file` | 发文件/图片/视频——本地路径或 HTTPS URL 都行 |
| `wechat_reload_heartbeat` | 手动刷新心跳配置 |

## 心跳配置

将 `heartbeat-config.example.json` 复制到 `~/.claude/weixin/heartbeat-config.json`：

```json
{
  "fixed": [{ "hour": 9, "minute": 0, "label": "morning" }],
  "random": { "active_start": 9, "active_end": 22, "daily_count": 10, "min_per_hour": 1 }
}
```

`fixed` 定点触发，`random` 随机分配。改了配置自动生效，不用重启。

## 权限远程审批

Claude 需要执行敏感操作时，审批请求自动发到微信。回复 `yes <id>` 批准，`no <id>` 拒绝。

## 安全提醒

这个项目会把微信变成 Claude Code 的远程入口，请按个人工具来使用：

- 只把你信任的微信账号加入白名单
- `--allow-all` 只建议第一次调试时使用
- 不要通过微信发送密码、token、密钥等敏感信息
- Claude Code 发来的权限审批，确认看懂后再回复 `yes <id>`
- 如果电脑不在自己控制的环境里，不建议长期运行

## 已知限制

| 限制 | 原因 |
|------|------|
| 仅 iOS 支持 ClawBot | 微信灰度阶段 |
| 视频只能保存文件，无法直接查看 | Claude 不支持原生视频输入 |
| ilink API 可能变更 | 微信未承诺第三方兼容性 |
| 消息经腾讯服务器 | 非端到端加密，不要通过此通道发送密码或密钥 |

## License

MIT
