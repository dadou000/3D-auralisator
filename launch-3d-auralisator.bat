@echo off
setlocal

cd /d "%~dp0"
set "PORT=8080"
set "URL=http://127.0.0.1:%PORT%/"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$client = [Net.Sockets.TcpClient]::new(); try { $pending = $client.BeginConnect('127.0.0.1', %PORT%, $null, $null); if ($pending.AsyncWaitHandle.WaitOne(200)) { $client.EndConnect($pending); exit 0 } exit 1 } catch { exit 1 } finally { $client.Close() }" >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  echo 3D Auralisator server already appears to be running at %URL%
  start "" "%URL%"
  exit /b 0
)

where py >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  set "PY_CMD=py -3"
) else (
  where python >nul 2>nul
  if %ERRORLEVEL% EQU 0 (
    set "PY_CMD=python"
  ) else (
    echo Python was not found. Install Python 3 or run a static web server in this folder.
    pause
    exit /b 1
  )
)

echo Starting 3D Auralisator at %URL%
start "3D Auralisator Server" cmd /k "%PY_CMD% -m http.server %PORT% --bind 127.0.0.1"
timeout /t 2 /nobreak >nul
start "" "%URL%"

endlocal
