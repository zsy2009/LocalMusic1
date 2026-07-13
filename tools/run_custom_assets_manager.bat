@echo off
chcp 65001 >nul
cd /d "%~dp0"
..\.venv\Scripts\python.exe custom_assets_manager.py
if errorlevel 1 pause
