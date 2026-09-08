@echo off
rem =====================================================================
rem  Yooh backend launcher (Windows)
rem  Starts the LOCAL Yooh server for iOS test builds:
rem    bind  0.0.0.0:1111   (CloudPub forwards
rem          https://yooh-test.cloudpub.ru/  ->  127.0.0.1:1111)
rem  Real entry point:  node src/server/index.js   (see package.json)
rem  This script NEVER kills foreign processes.
rem =====================================================================
setlocal EnableExtensions
cd /d "%~dp0"

set "YOOH_HOST=0.0.0.0"
set "YOOH_PORT=1111"
set "YOOH_ADMIN_PORT=1112"
set "PUBLIC_URL=https://yooh-test.cloudpub.ru/"

echo === Yooh backend launcher ===
echo Project: %CD%
echo.

rem --- 1. Node.js -------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found in PATH.
  echo Install Node.js 20+ from https://nodejs.org/ , reopen the terminal and retry.
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do echo Node: %%v

rem --- 2. Dependencies ----------------------------------------------------
if not exist "node_modules\express\package.json" (
  echo [INFO] Dependencies missing - installing with npm ci ...
  call npm ci --no-audit --no-fund
  if errorlevel 1 (
    echo [ERROR] npm ci failed. Check your network / npm setup and retry.
    pause
    exit /b 1
  )
) else (
  echo Dependencies: OK
)

rem --- 3. Port check (READ-ONLY, nothing is killed here) -------------------
set "BUSY_PID="
for /f "tokens=5" %%p in ('netstat -ano -p tcp ^| findstr LISTENING ^| findstr /r /c:":1111[^0-9]"') do set "BUSY_PID=%%p"

if defined BUSY_PID (
  echo.
  echo [INFO] Port 1111 is already LISTENING ^(PID %BUSY_PID%^).
  for /f "tokens=1" %%n in ('tasklist /FI "PID eq %BUSY_PID%" /FO TABLE /NH 2^>nul') do echo Owner process: %%n ^(PID %BUSY_PID%^)
  curl.exe -s -m 5 http://127.0.0.1:1111/health 2>nul | findstr "yooh" | findstr "service" >nul
  if not errorlevel 1 (
    echo This is a previous Yooh instance - reusing it instead of starting a second one.
    echo Local:  http://localhost:1111
    echo Admin:  http://localhost:1112/admin
    echo Public: %PUBLIC_URL% ^(needs CloudPub running on this PC^)
    pause
    exit /b 0
  ) else (
    echo [ERROR] Port 1111 is held by something that is NOT Yooh.
    echo Stop that process or free the port, then run start.bat again.
    echo ^(start.bat never terminates foreign processes.^)
    pause
    exit /b 1
  )
)

rem --- 4. Launch ------------------------------------------------------------
echo.
echo Starting Yooh backend on %YOOH_HOST%:%YOOH_PORT% ...
echo   Local:  http://localhost:1111
echo   Admin:  http://localhost:1112/admin
echo   Public: %PUBLIC_URL% ^(via CloudPub -^> 127.0.0.1:1111; start CloudPub separately^)
echo Press Ctrl+C to stop the server.
echo.

set "HOST=%YOOH_HOST%"
set "PORT=%YOOH_PORT%"
set "ADMIN_PORT=%YOOH_ADMIN_PORT%"
node src/server/index.js
set "EXITCODE=%ERRORLEVEL%"

echo.
if "%EXITCODE%"=="0" (
  echo [INFO] Server stopped normally.
) else (
  echo [ERROR] Server exited with code %EXITCODE%. See messages above.
)
pause
exit /b %EXITCODE%
