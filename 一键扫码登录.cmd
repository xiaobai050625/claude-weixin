@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================
echo   微信 Claude 桥接 — 扫码登录
echo ========================================
echo.
echo 正在获取微信登录二维码...
echo.
bun cli.ts setup
echo.
echo ========================================
echo 按任意键关闭...
pause >nul
