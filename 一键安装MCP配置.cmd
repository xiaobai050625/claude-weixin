@echo off
cd /d "%~dp0"
echo ========================================
echo   微信 Claude 桥接 — 安装 MCP 配置
echo ========================================
echo.
echo 在当前目录生成 MCP 连接配置...
echo.
bun cli.ts install
echo.
echo ========================================
echo 按任意键关闭...
pause >nul
