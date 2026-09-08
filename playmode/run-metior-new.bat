@echo off
setlocal EnableExtensions
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not in PATH.
  pause
  exit /b 1
)

echo [INFO] Installing root dependencies...
call npm install
if errorlevel 1 goto :fail

echo [INFO] Installing backend/frontend dependencies...
call npm run install:all
if errorlevel 1 goto :fail

echo [INFO] Freeing local ports 4000 and 5173 if occupied...
for %%p in (4000 5173) do (
  for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:":%%p .*LISTENING"') do (
    taskkill /PID %%a /F >nul 2>nul
  )
)

echo [INFO] Starting local Metior server and website...
echo [INFO] Open: http://127.0.0.1:5173
call npm run dev
if errorlevel 1 goto :fail

goto :ok

:fail
echo [ERROR] Startup failed.
pause
exit /b 1

:ok
pause
exit /b 0
