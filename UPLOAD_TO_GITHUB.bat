@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "GIT_CMD=git"
where git >nul 2>nul
if errorlevel 1 (
    set "GIT_CMD=C:\Users\User\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd\git.exe"
)

if not exist "%GIT_CMD%" (
    echo Git не найден. Установите Git for Windows: https://git-scm.com/download/win
    echo.
    pause
    exit /b 1
)

echo Отправка SMART SCB на GitHub...
echo.
"%GIT_CMD%" push -u origin main

if errorlevel 1 (
    echo.
    echo Не удалось отправить проект.
    echo Проверьте интернет и авторизацию GitHub.
) else (
    echo.
    echo Готово. Проект загружен:
    echo https://github.com/krasnyjperec6-design/smart-scb
)

echo.
pause
