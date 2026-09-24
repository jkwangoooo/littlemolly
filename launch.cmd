@echo off
rem ============================================================
rem  Happy Little Molly - quick launcher (double-click me)
rem  Interactive menu lives in scripts\launcher.mjs
rem  Pass an argument to run a task directly, e.g.:  launch.cmd 7
rem ============================================================
chcp 65001 >nul 2>nul
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [ERROR] Node.js not found in PATH.
  echo   Install Node.js 22+ first, then run this file again.
  echo.
  pause
  exit /b 1
)

node "%~dp0scripts\launcher.mjs" %*
exit /b %ERRORLEVEL%
