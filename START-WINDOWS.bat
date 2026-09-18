@echo off
setlocal
cd /d "%~dp0"
echo ==========================================
echo        AI StudyMate - Starting...
echo ==========================================
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is not installed.
  echo Install Node.js 20+ and run this file again.
  echo.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing dependencies for the first run...
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed. Please check your internet connection.
    pause
    exit /b 1
  )
)
echo.
echo AI StudyMate is starting...
echo Keep this window open.
echo Browser: http://localhost:7700
start "AI StudyMate" http://localhost:7700
call npm start
pause
