@echo off
cd /d "%~dp0"
echo ========================================
echo   微信 Claude 桥接 — 开启白名单
echo ========================================
echo.
echo 开启自动添加模式...
echo 下一个发消息的 sender 将自动加入白名单。
echo.
call bun cli.ts setup --allow-all
echo.
echo ========================================
echo 按任意键关闭...
pause
