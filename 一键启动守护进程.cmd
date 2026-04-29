@echo off
cd /d "%~dp0"
echo ========================================
echo   微信 Claude 桥接 — 启动守护进程
echo ========================================
echo.
echo 正在启动守护进程...
echo 微信消息监听中，请勿关闭此窗口。
echo 按 Ctrl+C 停止。
echo ========================================
echo.
bun daemon.ts
pause >nul
