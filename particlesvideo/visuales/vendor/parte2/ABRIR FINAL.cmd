@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" -Final
if errorlevel 1 pause
