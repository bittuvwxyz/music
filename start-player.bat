@echo off
title Song Player
cd /d "%~dp0"

echo ========================================================
echo                 Song Player - Music Player
echo ========================================================
echo.
echo Starting Song Player...
echo.

where python >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo Python detected. Launching local web server at http://localhost:8000 ...
    start "" http://localhost:8000
    python -m http.server 8000
) else (
    echo Opening Song Player in default browser...
    start "" "%~dp0index.html"
)
pause
