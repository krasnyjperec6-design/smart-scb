@echo off
chcp 65001 >nul
cd /d "%~dp0"

start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 1; Start-Process 'http://127.0.0.1:8080'"

where py >nul 2>nul
if %errorlevel%==0 (
    py -3 server.py
) else (
    python server.py
)

echo.
echo Сервер остановлен. Нажмите любую клавишу, чтобы закрыть окно.
pause >nul
