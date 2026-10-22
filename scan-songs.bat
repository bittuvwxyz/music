@echo off
echo Scanning songs folder for offline music...
powershell -ExecutionPolicy Bypass -File "%~dp0scan-songs.ps1"
echo Done! Refresh your Spotify clone in browser.
pause
