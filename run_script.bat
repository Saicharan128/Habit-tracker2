
@echo off
setlocal
cd /d "%~dp0"
python app.py
echo.
echo Press any key to continue...
pause >nul
