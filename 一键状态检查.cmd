@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================
echo   微信 Claude 桥接 — 状态检查
echo ========================================
echo.
bun cli.ts doctor
echo.
echo ========================================
echo 按任意键关闭...
pause >nul
