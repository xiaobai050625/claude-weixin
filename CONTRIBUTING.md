# Contributing

感谢你考虑为这个项目贡献！

## 如何参与

1. Fork 这个仓库
2. 创建你的分支：`git checkout -b feature/your-feature`
3. 提交改动：`git commit -m "Add your feature"`
4. 推送：`git push origin feature/your-feature`
5. 提交 Pull Request

## 开发环境

```bash
bun install
bun wechat-channel.ts  # 启动 MCP server
```

需要 [Bun](https://bun.sh) >= 1.0。

## 代码风格

- TypeScript，Bun 运行时
- 日志走 stderr（`log()` / `logError()`），stdout 留给 MCP stdio
- 模块职责单一，通过函数参数传递依赖

## 提交规范

简洁的中文或英文 commit message，描述做了什么。

## 报告 Bug

在 [Issues](https://github.com/LinekForge/claude-code-wechat/issues) 中提交，包含：
- 你的环境（Bun 版本、Claude Code 版本、微信版本）
- 复现步骤
- 实际行为 vs 期望行为
- stderr 日志（如有）

## 功能建议

同样在 Issues 中提交，标注 `[Feature Request]`。
