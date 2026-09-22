@echo off
chcp 65001 >nul
title 词频小说 · 本地预览
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 Python，请先安装 Python 3 并勾选 "Add to PATH"。
    pause
    exit /b 1
)

set PORT=8000

echo.
echo   正在启动本地服务器 ...
echo   电脑浏览器将自动打开：  http://localhost:%PORT%/html/
echo   手机 / 平板（同一 WiFi 下）：  http://本机IP:%PORT%/html/
echo   关闭本窗口即可停止服务。
echo.

start "" "http://localhost:%PORT%/html/"
python -m http.server %PORT%

pause