# Security

## 报告漏洞

如果你发现了安全问题，请**不要**在 Issues 中公开提交。

发送邮件到项目维护者，或通过 GitHub 的 [Security Advisories](https://github.com/LinekForge/claude-code-wechat/security/advisories) 私密报告。

## 安全设计

本项目处理微信凭据和消息内容，安全措施包括：

- **Sender Allowlist**：未授权消息在进入 Claude 上下文前静默丢弃
- **凭据文件权限**：account.json 等敏感文件写入时设为 0o600
- **Permission Relay**：工具调用审批需要白名单用户明确批准
- **无硬编码密钥**：所有凭据通过交互式登录获取，不在代码中存储

## 已知风险

| 风险 | 说明 |
|------|------|
| 消息经腾讯服务器 | ilink API 非端到端加密，请勿通过此通道传输密码或密钥 |
| 文件路径注入 | `wechat_send_file` 接受任意路径，理论上可被 prompt injection 利用发送敏感文件 |
| auto_allow_next | 开启后下一个发消息的人自动进白名单，仅在受控环境下使用 |
