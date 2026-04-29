@echo off
cd /d "%~dp0"
echo ========================================
echo   ④ 微信 Claude 桥接 — 状态检查
echo ========================================
echo.
bun cli.ts doctor
echo.
echo ========================================
echo 按任意键关闭...
pause
