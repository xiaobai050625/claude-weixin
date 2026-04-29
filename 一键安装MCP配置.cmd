@echo off
cd /d "%~dp0"
echo ========================================
echo   ③ 微信 Claude 桥接 — 安装 MCP 配置
echo ========================================
echo.
echo 在当前目录安装 MCP 配置到 Claude...
echo.
bun cli.ts install
echo.
echo ========================================
echo 按任意键关闭...
pause
